# Keep-Alive Service

A Node.js service that keeps your backend alive by making periodic authenticated requests.

## Features

- Runs continuously in the background
- Makes authenticated requests to your backend
- Logs all activities to console and files
- Handles errors gracefully
- Easy to deploy

## Prerequisites

- Node.js 16.x or higher
- npm or yarn

## Installation

1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy `.env.example` to `.env` and update the values:
   ```bash
   cp .env.example .env
   ```

## Configuration

Edit the `.env` file with your backend details:

```env
# Your backend base URL (without trailing slash)
API_BASE_URL=http://your-backend-url.com

# Login credentials for the keep-alive service
KEEP_ALIVE_EMAIL=your-email@example.com
KEEP_ALIVE_PASSWORD=your-secure-password

# How often to ping the server (in milliseconds)
KEEP_ALIVE_INTERVAL=840000  # 14 minutes

# Log level (error, warn, info, debug)
LOG_LEVEL=info
```

## Running the Service

### Development Mode

```bash
npm run dev
```

### Production Mode

```bash
npm start
```

### Running in Background (Linux/macOS)

```bash
nohup node index.js > logs/keep-alive.log 2>&1 &
```

### Running as a Windows Service

1. Install `node-windows` globally:
   ```bash
   npm install -g node-windows
   ```
2. Create a `service.js` file with the following content:
   ```javascript
   const Service = require('node-windows').Service;
   const path = require('path');

   const svc = new Service({
     name: 'KeepAliveService',
     description: 'Keeps the backend service alive',
     script: path.join(__dirname, 'index.js'),
     nodeOptions: [
       '--harmony',
       '--max_old_space_size=4096'
     ]
   });

   svc.on('install', () => {
     console.log('Service installed');
     svc.start();
   });

   svc.install();
   ```
3. Run the service installer:
   ```bash
   node service.js
   ```

## Logs

Logs are stored in the `logs` directory:
- `combined.log` - All logs
- `error.log` - Error logs only

## Monitoring

You can monitor the service by checking the logs or by setting up a monitoring solution like PM2:

```bash
# Install PM2 globally
npm install -g pm2

# Start the service with PM2
pm2 start index.js --name "keep-alive-service"

# Monitor logs
pm2 logs keep-alive-service

# Save process list for auto-restart on reboot
pm2 save
pm2 startup
```

## License

MIT
