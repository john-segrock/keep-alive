module.exports = {
  apps: [{
    name: 'keep-alive-service',
    script: 'index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'development',
    },
    env_production: {
      NODE_ENV: 'production',
    },
    error_file: 'logs/err.log',
    out_file: 'logs/out.log',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    // Auto-restart if memory usage exceeds 500MB
    max_memory_restart: '500M',
    // Restart the app if it reaches 5GB of memory
    max_memory_restart: '5G',
    // Restart the app if it becomes unresponsive (5 minutes timeout)
    kill_timeout: 300000,
    // Wait 10 seconds between restarts
    min_uptime: '10s',
    // Max number of restart in 1 minute
    max_restarts: 10,
    // Time to wait before considering the app as started (30 seconds)
    listen_timeout: 30000,
    // Time to wait before sending SIGKILL
    kill_timeout: 5000
  }]
};
