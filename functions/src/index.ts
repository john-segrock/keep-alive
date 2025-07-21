import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import axios from 'axios';
import * as path from 'path';
const winston = require('winston');
const { combine, timestamp, errors, splat, json, colorize, printf } = winston.format;
const DailyRotateFile = require('winston-daily-rotate-file');

// Initialize Firebase Admin
admin.initializeApp();

// Configure logger
const logDir = path.join(process.cwd(), 'logs');

const logFormat = combine(
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  errors({ stack: true }),
  splat(),
  json()
);

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  defaultMeta: { service: 'keep-alive-service' },
  transports: [
    new winston.transports.Console({
      format: combine(
        colorize(),
        printf(({
          level,
          message,
          timestamp,
          ...meta
        }: {
          level: string;
          message: string;
          timestamp: string;
          [key: string]: any;
        }) => {
          return `${timestamp} ${level}: ${message} ${
            Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ''
          }`;
        })
      )
    }),
    new DailyRotateFile({
      filename: path.join(logDir, 'keep-alive-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '14d',
    })
  ]
});

// Global state
let currentCookies: string | null = null;
let isLoggedIn = false;
let lastError: Error | null = null;
let lastRunTime: Date | null = null;
let nextRunTime: Date | null = null;
let failedRuns = 0;

// Create axios instance
const api = axios.create({
  baseURL: process.env.API_BASE_URL,
  withCredentials: true,
  timeout: 30000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest'
  }
});

// Helper function to validate required environment variables
function validateEnv() {
  const requiredVars = [
    'API_BASE_URL',
    'API_USERNAME',
    'API_PASSWORD',
    'KEEP_ALIVE_INTERVAL'
  ];

  const missingVars = requiredVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
  }
}

// Validate environment variables on startup
validateEnv();

// Login function
async function performLogin() {
  try {
    logger.info('🔐 Attempting to log in...');
    
    const response = await api.post('/api/auth/login', {
      username: process.env.API_USERNAME,
      password: process.env.API_PASSWORD,
      rememberMe: true
    });

    if (response.status === 200 && response.data.success) {
      isLoggedIn = true;
      const cookies = response.headers['set-cookie'];
      if (cookies && cookies.length > 0) {
        currentCookies = cookies.join('; ');
        api.defaults.headers.Cookie = currentCookies;
      }
      logger.info('✅ Login successful');
      return true;
    }
    
    throw new Error('Login failed: Invalid response from server');
  } catch (error: any) {
    logger.error(`❌ Login failed: ${error.message}`);
    throw error;
  }
}

// Logout function
async function performLogout() {
  if (!isLoggedIn || !currentCookies) return true;

  try {
    logger.info('🔒 Logging out...');
    
    await api.post('/api/auth/logout', {}, {
      headers: { 
        'Cookie': currentCookies,
        'X-Requested-With': 'XMLHttpRequest'
      },
      timeout: 5000
    });
    
    logger.info('✅ Logout successful');
    return true;
  } catch (error: any) {
    logger.warn(`⚠️ Logout failed: ${error.message}`);
    return false;
  } finally {
    isLoggedIn = false;
    currentCookies = null;
    delete api.defaults.headers.Cookie;
  }
}

// Keep alive function
async function keepAlive() {
  const startTime = Date.now();
  
  try {
    if (!isLoggedIn) {
      await performLogin();
    }

    logger.info('🔄 Sending keep-alive request...');
    
    const response = await api.get('/api/user/me', {
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      },
      timeout: 30000
    });

    if (response.status === 200 && response.data.success) {
      logger.info('✅ Keep-alive successful');
      failedRuns = 0;
      lastError = null;
    } else {
      throw new Error('Invalid response from server');
    }
    
  } catch (error: any) {
    failedRuns++;
    lastError = error;
    logger.error(`❌ Keep-alive failed: ${error.message}`);
    
    // If we have too many failed attempts, force logout and login
    if (failedRuns >= 3) {
      logger.info('Too many failed attempts, forcing re-login...');
      await performLogout();
      await performLogin();
    }
    
    throw error;
  } finally {
    const duration = (Date.now() - startTime) / 1000;
    logger.info(`⏱️ Keep-alive cycle completed in ${duration.toFixed(2)}s`);
  }
}

// HTTP function for manual triggering
export const keepAliveHttp = onRequest(async (req, res) => {
  // Set CORS headers
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  try {
    logger.info('🚀 HTTP trigger received');
    await keepAlive();
    res.status(200).json({
      success: true,
      message: 'Keep-alive successful',
      timestamp: new Date().toISOString(),
      nextRunTime: nextRunTime?.toISOString()
    });
  } catch (error: any) {
    logger.error(`❌ HTTP handler error: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Scheduled function (runs every 12 minutes by default)
export const scheduledKeepAlive = onSchedule('every 12 minutes', async (event) => {
  try {
    logger.info('⏰ Scheduled trigger received');
    lastRunTime = new Date();
    nextRunTime = new Date(lastRunTime.getTime() + (12 * 60 * 1000));
    
    await keepAlive();
    
    logger.info(`✅ Scheduled keep-alive completed. Next run at: ${nextRunTime.toISOString()}`);
    // No need to return anything (implicitly returns undefined which is compatible with void)
  } catch (error: any) {
    logger.error(`❌ Scheduled keep-alive failed: ${error.message}`);
    throw error;
  }
});

// Health check endpoint
export const healthCheck = onRequest((req, res) => {
  const memory = process.memoryUsage();
  const memoryInMB = {
    rss: (memory.rss / 1024 / 1024).toFixed(2) + ' MB',
    heapTotal: (memory.heapTotal / 1024 / 1024).toFixed(2) + ' MB',
    heapUsed: (memory.heapUsed / 1024 / 1024).toFixed(2) + ' MB',
    external: (memory.external / 1024 / 1024).toFixed(2) + ' MB'
  };

  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: memoryInMB,
    isLoggedIn,
    lastRunTime: lastRunTime?.toISOString(),
    nextRunTime: nextRunTime?.toISOString(),
    failedRuns,
    lastError: lastError?.message || null
  });
});
