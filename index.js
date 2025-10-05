import dotenv from 'dotenv';
import axios from 'axios';
import winston from 'winston';
import winstonDailyRotate from 'winston-daily-rotate-file';
import express from 'express';
import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

// Configure environment variables (force .env to override system env when present)
dotenv.config({ override: true });

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

// Request logging middleware
app.use((req, res, next) => {
    const start = Date.now();
    
    res.on('finish', () => {
        const duration = Date.now() - start;
        logger.info(`📡 ${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms)`, {
            ip: req.ip,
            userAgent: req.headers['user-agent'],
            statusCode: res.statusCode,
            duration: `${duration}ms`,
            referrer: req.headers.referer || '',
            host: req.headers.host
        });
    });
    
    next();
});

// Simple root endpoint for basic health checks
app.get('/', (req, res) => {
    const status = {
        status: 'ok',
        service: 'keep-alive-service',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        nodeVersion: process.version,
        memoryUsage: {
            rss: `${(process.memoryUsage().rss / 1024 / 1024).toFixed(2)} MB`,
            heapTotal: `${(process.memoryUsage().heapTotal / 1024 / 1024).toFixed(2)} MB`,
            heapUsed: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`,
        },
        lastRun: lastRunTime?.toISOString() || 'Never',
        nextRun: nextRunTime?.toISOString() || 'Scheduled after next restart',
        isLoggedIn,
        successfulRuns,
        failedRuns,
        totalRuns
    };

    res.status(200).json(status);
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
        
        const health = {
            status: 'UP',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            checks: [
                {
                    name: 'backend_connection',
                    status: isLoggedIn ? 'UP' : 'DOWN',
                    lastCheck: lastRunTime?.toISOString() || 'Never',
                    nextCheck: nextRunTime?.toISOString() || 'Scheduled after next restart'
                },
                {
                    name: 'database',
                    status: 'N/A',
                    message: 'No database connection required'
                },
                {
                    name: 'memory_usage',
                    status: 'OK',
                    rss: `${(process.memoryUsage().rss / 1024 / 1024).toFixed(2)} MB`,
                    heapTotal: `${(process.memoryUsage().heapTotal / 1024 / 1024).toFixed(2)} MB`,
                    heapUsed: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`,
                }
            ],
            stats: {
                successfulRuns,
                failedRuns,
                totalRuns,
                lastError: lastError ? lastError.message : null
            }
        };

        // Log health check with more details
        logger.info('🏥 Health check', {
            status: health.status,
            backendStatus: health.checks[0].status,
            memory: health.checks[2].rss,
            uptime: health.uptime
        });

        res.status(200).json(health);
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

// Simple ping endpoint for basic monitoring
app.get('/ping', (req, res) => {
    res.status(200).send('pong');
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
// nextAction toggles between 'login' and 'logout' to keep equal spacing
let nextAction = 'login';
let isKeepAliveRunning = false; // prevent overlapping runs
let lastAlertSentAt = null; // timestamp of last alert email sent
const alertCooldownMs = Number(process.env.ALERT_COOLDOWN_MS) || (60 * 1000);
let alertSuppressed = false; // when true, don't send additional alert emails until a success clears it

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

// Configure email transporter if SMTP settings provided
let mailerTransport = null;
function configureMailer() {
    const host = process.env.SMTP_HOST;
    const port = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (host && port && user && pass) {
        mailerTransport = nodemailer.createTransport({
            host,
            port,
            secure: port === 465, // true for 465, false for other ports
            auth: {
                user,
                pass
            }
        });
        logger.info('✉️ Mailer configured');
    } else {
        logger.info('✉️ Mailer not configured - set SMTP_HOST/PORT/USER/PASS to enable alerts');
    }
}

async function sendAlertEmail(subject, text) {
    if (!mailerTransport) {
        logger.warn('✉️ Mailer not configured, cannot send alert email');
        return false;
    }

    const to = process.env.ALERT_EMAIL;
    if (!to) {
        logger.warn('✉️ ALERT_EMAIL not set; skipping alert');
        return false;
    }

    try {
        await mailerTransport.sendMail({
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            to,
            subject,
            text
        });
        logger.info(`✉️ Alert email sent to ${to}`);
        return true;
    } catch (err) {
        logger.error('✉️ Failed to send alert email:', err);
        return false;
    }
}

// Function to perform login with retry logic
async function performLogin() {
    let attempt = 1;
    const maxAttempts = 10;
    const baseDelay = 5000; // 5 seconds initial delay
    
    while (attempt <= maxAttempts) {
        try {
    logger.debug(`Login attempt ${attempt}/${maxAttempts}`);
            
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
            
            const cookies = loginResponse.headers['set-cookie']?.join('; ');
            const userEmail = loginResponse.data?.email || 'N/A';
            // internal success logged at debug level to avoid duplication with user-facing info logs
            logger.debug(`✅ Login successful (internal)${userEmail && userEmail !== 'N/A' ? ` for: ${userEmail}` : ''}`);
            
            return {
                success: true,
                cookies
            };
            
        } catch (error) {
            const waitTime = Math.min(baseDelay * Math.pow(2, attempt - 1), 30000); // Cap at 30s
            logger.warn(`Login attempt ${attempt} failed: ${error.message}`);
            
            if (attempt === maxAttempts) {
                const retryDelayMs = 60 * 1000; // 1 minute
                // set nextRunTime so health endpoint and logs reflect when we'll retry
                nextRunTime = new Date(Date.now() + retryDelayMs);
                const msg = `❌ Max login attempts reached; will retry in ${Math.round(retryDelayMs/1000)}s (nextRun=${nextRunTime.toISOString()})`;
                logger.error(msg);

                // Throttle alerts using cooldown and only send if not already suppressed
                const now = Date.now();
                if (!alertSuppressed && (!lastAlertSentAt || (now - lastAlertSentAt) > alertCooldownMs)) {
                    lastAlertSentAt = now;
                    alertSuppressed = true; // suppress further alerts until a success clears it
                    sendAlertEmail('Keep-alive service: max login attempts reached', `The keep-alive service failed to login ${maxAttempts} times. Backend: ${process.env.API_BASE_URL}. Time: ${new Date().toISOString()}`)
                        .then(sent => {
                            if (sent) {
                                logger.info(`✉️ Alert email sent to ${process.env.ALERT_EMAIL}`);
                            }
                        })
                        .catch(e => logger.error('Error sending alert email', e));
                } else {
                    logger.info('✉️ Alert suppressed (already sent or in cooldown)');
                }

                // Immediately attempt a fresh follow-up batch of maxAttempts to continue the cycle
                logger.info('🔁 Starting follow-up login batch after alert to continue attempts');
                for (let follow = 1; follow <= maxAttempts; follow++) {
                    try {
                        logger.debug(`Follow-up login attempt ${follow}/${maxAttempts}`);
                        const followResp = await api.post('/api/auth/login', {
                            email: process.env.KEEP_ALIVE_EMAIL,
                            password: process.env.KEEP_ALIVE_PASSWORD
                        }, {
                            headers: {
                                'Content-Type': 'application/json',
                                'X-Requested-With': 'XMLHttpRequest'
                            },
                            timeout: 10000
                        });

                        const cookies = followResp.headers['set-cookie']?.join('; ');
                        const userEmail = followResp.data?.email || 'N/A';
                        logger.debug(`✅ Follow-up login successful (internal)${userEmail && userEmail !== 'N/A' ? ` for: ${userEmail}` : ''}`);
                        // clear suppression on success
                        alertSuppressed = false;
                        return { success: true, cookies };
                    } catch (e) {
                        logger.warn(`Follow-up login attempt ${follow} failed: ${e.message}`);
                        // small delay between follow-up attempts
                        await new Promise(r => setTimeout(r, Math.min(baseDelay * Math.pow(2, follow - 1), 30000)));
                    }
                }

                // if follow-up also failed, return failure
                return { success: false };
            }
            
            // Wait before next attempt
            await new Promise(resolve => setTimeout(resolve, waitTime));
            attempt++;
        }
    }
    
    return { success: false };
}

// Function to perform logout with retry logic
async function performLogout(cookies) {
    let attempt = 1;
    const maxAttempts = 2;
    
    while (attempt <= maxAttempts) {
        try {
            logger.debug(`Logout attempt ${attempt}/${maxAttempts}`);
            
            await api.post('/api/auth/logout', {}, {
                headers: { 
                    'Cookie': cookies,
                    'X-Requested-With': 'XMLHttpRequest'
                },
                timeout: 10000
            });
            
            // internal success logged at debug level to avoid duplication with user-facing info logs
            logger.debug('✅ Logout successful (internal)');
            return true;
            
        } catch (error) {
            logger.warn(`Logout attempt ${attempt} failed: ${error.message}`);
            if (attempt === maxAttempts) {
                logger.warn('Max logout attempts reached. Will proceed to login cycle.');
                return false;
            }
            
            // Short delay before next attempt
            await new Promise(resolve => setTimeout(resolve, 5000));
            attempt++;
        }
    }
    
    return false;
}

// Keep alive function with retry-until-success logic
async function keepAlive() {
    const startTime = Date.now();
    lastRunTime = new Date();
    totalRuns++;
    
    try {
        logger.info(`Keep-alive cycle start: action=${nextAction}`);

        if (nextAction === 'logout') {
            // attempt logout
            logger.info('🚪 Attempting logout');
            const logoutSuccess = await performLogout(currentCookies);

            if (logoutSuccess) {
                isLoggedIn = false;
                currentCookies = null;
                successfulRuns++;
                logger.info('✅ Logout completed');
            } else {
                failedRuns++;
                logger.warn('❌ Logout failed');
            }

            // toggle for next run
            nextAction = 'login';
        } else {
            // attempt login
            logger.info('🔑 Attempting login');
            const { success, cookies } = await performLogin();

            if (success) {
                isLoggedIn = true;
                currentCookies = cookies;
                successfulRuns++;
                logger.info('✅ Login completed');
            } else {
                failedRuns++;
                lastError = new Error('Login failed');
                logger.warn('❌ Login failed');
            }

            // toggle for next run
            nextAction = 'logout';
        }
        
    const duration = (Date.now() - startTime) / 1000;
    logger.info(`⏭️ Keep-alive completed: duration=${duration.toFixed(2)}s — next=${nextAction}`);
        
    } catch (error) {
        failedRuns++;
        lastError = error;
        logger.error(`❌ Error in keep-alive cycle: ${error.message}`);
        
        // On unexpected errors, retry login cycle in 1 minute
        nextRunTime = new Date(Date.now() + (1 * 60 * 1000));
        logger.info(`⏭️ Retrying after error at: ${nextRunTime.toISOString()}`);
    }
    
    return true;
}

// Main function
async function main() {
    try {
        // Validate environment variables
        validateEnv();

    // Configure mailer transport (if SMTP vars are present)
    configureMailer();
        
    // Use environment variable with default of 12 minutes (720000 ms)
    // Accept raw numbers (milliseconds) and ignore inline comments after a '#'
    const rawEnvValue = (process.env.KEEP_ALIVE_INTERVAL || '').toString();
    const rawInterval = rawEnvValue.split('#')[0].trim().split(/\s+/)[0];
    const parsed = Number(rawInterval);
    const interval = Number.isFinite(parsed) && parsed > 0 ? parsed : (12 * 60 * 1000);
        
        // Function to run keepAlive and handle any errors
        const runKeepAlive = async () => {
            if (isKeepAliveRunning) {
                logger.debug('⏱ Previous keep-alive run still executing; skipping this interval');
                return;
            }
            isKeepAliveRunning = true;
            try {
                await keepAlive();
            } catch (error) {
                failedRuns++;
                lastError = error;
                logger.error('Error in keep-alive:', error);
            } finally {
                isKeepAliveRunning = false;
                lastRunTime = new Date();
                nextRunTime = new Date(Date.now() + interval);
                logger.info(`⏭️ Next run at: ${nextRunTime.toLocaleTimeString()}`);
            }
        };
        
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
