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

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        load: os.loadavg(),
        env: process.env.NODE_ENV || 'development'
    });
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

// Track service metrics
let lastRunTime = null;
let nextRunTime = null;
let totalRuns = 0;
let successfulRuns = 0;
let failedRuns = 0;
let lastError = null;

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
            
            // Step 1: Login
            logger.info('1/3: Logging in...');
            const loginResponse = await api.post('/api/auth/login', {
                email: process.env.KEEP_ALIVE_EMAIL,
                password: process.env.KEEP_ALIVE_PASSWORD
            });
            
            // Get cookies from the response
            const cookies = loginResponse.headers['set-cookie'];
            
            // Step 2: Verify session
            logger.info('2/3: Verifying session...');
            const meResponse = await api.get('/api/auth/me', {
                headers: { Cookie: cookies },
                timeout: 10000 // 10 seconds timeout for this request
            });
            
            const userEmail = meResponse.data?.email || 'N/A';
            logger.info(`✅ Session active for: ${userEmail}`);
            
            // Step 3: Logout
            logger.info('3/3: Logging out...');
            await api.post('/api/auth/logout', {}, {
                headers: { Cookie: cookies },
                timeout: 5000 // 5 seconds timeout for logout
            });
            
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
        
        logger.info('🚀 Starting Keep-Alive Service');
        logger.info(`🔗 Backend URL: ${process.env.API_BASE_URL}`);
        logger.info(`⏱️  Keep-alive interval: ${(process.env.KEEP_ALIVE_INTERVAL / 60000).toFixed(0)} minutes`);
        logger.info(`🌐 Health check available at http://localhost:${PORT}/health`);
        
        // Function to run keepAlive and handle any uncaught errors
        const runKeepAlive = async () => {
            try {
                await keepAlive();
            } catch (error) {
                logger.error('Unhandled error in keepAlive:', error);
            } finally {
                // Schedule next run
                nextRunTime = new Date(Date.now() + (parseInt(process.env.KEEP_ALIVE_INTERVAL) || 840000));
                logger.info(`⏭️ Next run scheduled for: ${nextRunTime.toISOString()}`);
            }
        };
        
        // Initial run
        logger.info('Running initial keep-alive check...');
        await runKeepAlive();
        
        // Set up interval for subsequent runs
        const intervalId = setInterval(() => {
            runKeepAlive().catch(error => {
                logger.error('Error in scheduled keep-alive:', error);
            });
        }, parseInt(process.env.KEEP_ALIVE_INTERVAL) || 840000);
        
        // Handle process termination
        const shutdown = async (signal) => {
            logger.info(`Received ${signal}. Shutting down gracefully...`);
            
            // Clear the interval
            clearInterval(intervalId);
            
            // Close the HTTP server
            server.close(() => {
                logger.info('HTTP server closed.');
                process.exit(0);
            });
            
            // Force exit after timeout
            setTimeout(() => {
                logger.warn('Forcing shutdown after timeout...');
                process.exit(1);
            }, 10000);
        };
        
        // Handle various termination signals
        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('SIGTERM', () => shutdown('SIGTERM'));
        
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
