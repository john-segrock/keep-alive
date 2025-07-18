import dotenv from 'dotenv';
import axios from 'axios';
import winston from 'winston';
import winstonDailyRotate from 'winston-daily-rotate-file';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

// Configure environment variables
dotenv.config();

// Get the current directory name in ES module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create logs directory if it doesn't exist
const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
}

// Configure logger
const logFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
);

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: logFormat,
    defaultMeta: { service: 'keep-alive-service' },
    transports: [
        // Console transport
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.printf(
                    ({ level, message, timestamp, ...meta }) => {
                        return `${timestamp} ${level}: ${message} ${
                            Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ''
                        }`;
                    }
                )
            )
        }),
        // Daily rotate file transport for all logs
        new winstonDailyRotate({
            filename: path.join(logDir, 'application-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            zippedArchive: true,
            maxSize: '20m',
            maxFiles: '14d',
            level: process.env.LOG_LEVEL || 'info'
        }),
        // Error logs
        new winstonDailyRotate({
            filename: path.join(logDir, 'error-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            zippedArchive: true,
            maxSize: '20m',
            maxFiles: '30d',
            level: 'error'
        })
    ],
    exceptionHandlers: [
        new winston.transports.File({ 
            filename: path.join(logDir, 'exceptions.log') 
        })
    ],
    exitOnError: false
});

// Create Express app for health checks
const app = express();
const PORT = process.env.PORT || 3000;

// Simple CORS middleware
app.use((req, res, next) => {
    // Allow all origins
    res.header('Access-Control-Allow-Origin', '*');
    // Allow common headers
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    // Allow common methods
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    next();
});

// Simple root endpoint for basic health checks
app.get('/', (req, res) => {
    res.status(200).json({
        status: 'ok',
        service: 'keep-alive-service',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Health check endpoint with detailed system information
app.get('/health', (req, res) => {
    try {
        const memory = process.memoryUsage();
        const memoryInMB = {};
        
        // Convert bytes to MB for better readability
        Object.keys(memory).forEach(key => {
            memoryInMB[key] = `${Math.round(memory[key] / 1024 / 1024 * 100) / 100} MB`;
        });
        
        res.status(200).json({
            status: 'OK',
            service: 'keep-alive-service',
            timestamp: new Date().toISOString(),
            uptime: `${Math.floor(process.uptime() / 60)} minutes`,
            memory: memoryInMB,
            load: os.loadavg(),
            platform: process.platform,
            nodeVersion: process.version,
            env: process.env.NODE_ENV || 'development',
            lastRun: lastRunTime,
            nextRun: nextRunTime,
            stats: {
                totalRuns,
                successfulRuns,
                failedRuns,
                successRate: totalRuns > 0 ? Math.round((successfulRuns / totalRuns) * 100) : 0
            }
        });
    } catch (error) {
        logger.error('Error in health check:', error);
        res.status(500).json({
            status: 'ERROR',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Simple metrics endpoint
app.get('/metrics', (req, res) => {
    res.status(200).json({
        lastRun: lastRunTime,
        nextRun: nextRunTime,
        totalRuns,
        successfulRuns,
        failedRuns,
        lastError: lastError ? lastError.message : null
    });
});

// Start the HTTP server
const server = app.listen(PORT, () => {
    logger.info(`🚀 Health check server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    logger.info('SIGTERM received. Shutting down gracefully...');
    server.close(() => {
        logger.info('HTTP server closed.');
        process.exit(0);
    });
});

// Track service metrics and state
let lastRunTime = null;
let nextRunTime = null;
let totalRuns = 0;
let successfulRuns = 0;
let failedRuns = 0;
let lastError = null;
let isLoggedIn = false; // Track login state to alternate between login/logout
let currentCookies = null; // Store cookies for logout

// Validate environment variables
function validateEnv() {
    const requiredVars = [
        'API_BASE_URL',
        'KEEP_ALIVE_EMAIL',
        'KEEP_ALIVE_PASSWORD'
    ];

    const missingVars = requiredVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
        logger.error(`Missing required environment variables: ${missingVars.join(', ')}`);
        process.exit(1);
    }

    // Remove trailing slash from base URL if present
    process.env.API_BASE_URL = process.env.API_BASE_URL.replace(/\/$/, '');
}

// Create axios instance
const api = axios.create({
    baseURL: process.env.API_BASE_URL,
    withCredentials: true,
    timeout: 30000 // 30 seconds timeout
});

// Keep alive function with retry mechanism
async function keepAlive() {
    const startTime = Date.now();
    let success = false;
    let attempt = 1;
    const maxAttempts = 3;
    const baseDelay = 5000; // 5 seconds
    
    // Update tracking variables
    lastRunTime = new Date();
    totalRuns++;
    
    while (attempt <= maxAttempts && !success) {
        try {
            if (attempt > 1) {
                const delay = baseDelay * Math.pow(2, attempt - 1);
                logger.warn(`Retry attempt ${attempt}/${maxAttempts} after ${delay}ms delay...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
            
            logger.info(`🚀 Keep-alive attempt ${attempt}/${maxAttempts}...`);
            
            if (isLoggedIn) {
                // Perform logout
                logger.info('Performing logout...');
                await api.post('/api/auth/logout', {}, {
                    headers: { 
                        'Cookie': currentCookies,
                        'X-Requested-With': 'XMLHttpRequest'
                    },
                    timeout: 10000
                });
                logger.info('✅ Logout successful');
                isLoggedIn = false;
                currentCookies = null;
            } else {
                // Perform login and verify session
                logger.info('Performing login...');
                const loginResponse = await api.post('/api/auth/login', {
                    email: process.env.KEEP_ALIVE_EMAIL,
                    password: process.env.KEEP_ALIVE_PASSWORD
                }, {
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Requested-With': 'XMLHttpRequest'
                    },
                    timeout: 10000
                });
                
                // Get cookies from the response
                currentCookies = loginResponse.headers['set-cookie']?.join('; ');
                
                // Verify session
                const meResponse = await api.get('/api/auth/me', {
                    headers: { 
                        'Cookie': currentCookies,
                        'X-Requested-With': 'XMLHttpRequest'
                    },
                    timeout: 10000
                });
                
                const userEmail = meResponse.data?.email || 'N/A';
                logger.info(`✅ Login successful for: ${userEmail}`);
                isLoggedIn = true;
            }
            
            success = true;
            successfulRuns++;
            lastError = null;
            
            const duration = (Date.now() - startTime) / 1000;
            logger.info(`✅ Keep-alive sequence completed successfully in ${duration.toFixed(2)}s`);
            
        } catch (error) {
            const errorMessage = error.response?.data?.message || error.message;
            const statusCode = error.response?.status;
            lastError = error;
            
            logger.error(`❌ Attempt ${attempt} failed: ${errorMessage} ${statusCode ? `(Status: ${statusCode})` : ''}`);
            
            if (attempt === maxAttempts) {
                failedRuns++;
                logger.error(`❌ All ${maxAttempts} attempts failed. Will retry on next interval.`);
            }
            
            // Log full error in debug mode or on last attempt
            if (process.env.LOG_LEVEL === 'debug' || attempt === maxAttempts) {
                logger.debug('Error details:', {
                    message: error.message,
                    stack: error.stack,
                    response: error.response?.data
                });
            }
            
            attempt++;
        }
    }
    
    return success;
}

// Main function
async function main() {
    try {
        // Validate environment variables
        validateEnv();
        
        logger.info('🚀 Starting keep-alive service...');
        logger.info(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
        logger.info(`🌐 Backend URL: ${process.env.API_BASE_URL}`);
        
        // Set the interval to 14 minutes (840000 ms)
        const interval = 14 * 60 * 1000;
        logger.info(`⏱  Keep-alive interval: ${interval / 60000} minutes`);
        
        // Function to run keepAlive and handle any errors
        const runKeepAlive = async () => {
            try {
                await keepAlive();
                successfulRuns++;
            } catch (error) {
                failedRuns++;
                lastError = error;
                logger.error('Error in keep-alive:', error);
            } finally {
                lastRunTime = new Date();
                nextRunTime = new Date(Date.now() + interval);
                logger.info(`⏭️ Next run at: ${nextRunTime.toLocaleTimeString()}`);
            }
        };
        
        // Initial run (will perform login on first run)
        logger.info('Running initial keep-alive check...');
        await runKeepAlive();
        
        // Set up interval for subsequent runs
        const intervalId = setInterval(runKeepAlive, interval);
        
        // Handle process termination
        const shutdown = async (signal) => {
            logger.info(`Received ${signal}. Shutting down gracefully...`);
            
            // Clear the interval
            clearInterval(intervalId);
            
            // Try to log out if currently logged in
            if (isLoggedIn && currentCookies) {
                try {
                    await api.post('/api/auth/logout', {}, {
                        headers: { 
                            'Cookie': currentCookies,
                            'X-Requested-With': 'XMLHttpRequest'
                        },
                        timeout: 5000
                    });
                    logger.info('Successfully logged out before shutdown');
                } catch (error) {
                    logger.warn('Error during final logout:', error.message);
                }
            }
            
            // Close the HTTP server
            server.close(() => {
                logger.info('HTTP server closed.');
                process.exit(0);
            });
        };

        // Set up signal handlers for graceful shutdown
        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));

        // Handle uncaught exceptions
        process.on('uncaughtException', (error) => {
            logger.error('Uncaught Exception:', error);
            // Don't exit for uncaught exceptions to keep the process running
            // The error is logged and we'll try to continue
        });
        
        // Handle unhandled promise rejections
        process.on('unhandledRejection', (reason, promise) => {
            logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
            // Don't exit for unhandled rejections to keep the process running
        });

        // Log startup completion
        logger.info('✅ Service is running and ready');
        logger.info(`🌐 Health check available at http://localhost:${PORT}/health`);
        
    } catch (error) {
        logger.error('Fatal error during service startup:', error);
        process.exit(1);
    }
}

// Start the service
main().catch(error => {
    logger.error('Fatal error in keep-alive service:', error);
    process.exit(1);
});
