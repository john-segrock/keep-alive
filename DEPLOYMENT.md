# Keep-Alive Service - Firebase Deployment Guide

This guide will walk you through deploying the Keep-Alive Service to Firebase Functions.

## Prerequisites

1. Install Node.js (v18 or later)
2. Install Firebase CLI:
   ```bash
   npm install -g firebase-tools
   ```
3. Log in to Firebase:
   ```bash
   firebase login
   ```

## Deployment Steps

### 1. Initialize Firebase Project

```bash
# Navigate to the project root
cd keep-alive-service

# Initialize Firebase (select Functions and Hosting when prompted)
firebase init

# During initialization:
# - Select "Functions" and "Hosting"
# - Choose "Use an existing project" or create a new one
# - Select TypeScript when asked
# - Answer "No" to ESLint and install dependencies
```

### 2. Set Up Environment Variables

Set the required environment variables in Firebase:

```bash
firebase functions:config:set \
  keepalive.api_base_url="YOUR_API_BASE_URL" \
  keepalive.api_username="YOUR_USERNAME" \
  keepalive.api_password="YOUR_PASSWORD" \
  keepalive.keep_alive_interval="720000" \
  keepalive.log_level="info"
```

### 3. Deploy to Firebase

```bash
# Navigate to the functions directory
cd functions

# Install dependencies
npm install

# Build the TypeScript code
npm run build

# Deploy to Firebase
firebase deploy --only functions
```

### 4. Verify Deployment

After deployment, you'll receive URLs for your functions. Test them:

1. **Health Check**: `https://[YOUR-PROJECT-REGION]-[YOUR-PROJECT-ID].cloudfunctions.net/healthCheck`
2. **Manual Trigger**: `https://[YOUR-PROJECT-REGION]-[YOUR-PROJECT-ID].cloudfunctions.net/keepAliveHttp`

The scheduled function will run automatically based on the schedule (default: every 12 minutes).

## Available Functions

- `scheduledKeepAlive`: Runs on a schedule (default: every 12 minutes)
- `keepAliveHttp`: Can be triggered manually via HTTP
- `healthCheck`: Returns the service status and metrics

## Monitoring and Logs

View logs in the Firebase Console:

```bash
firebase functions:log
```

Or in the [Firebase Console](https://console.firebase.google.com/) under "Functions" > "Logs".

## Updating Environment Variables

To update environment variables:

```bash
firebase functions:config:set keepalive.api_username="new_username"
firebase deploy --only functions
```

## Troubleshooting

- **Cold Starts**: The first request after deployment might be slow due to cold starts
- **Timeouts**: Default timeout is 60 seconds. Adjust in `firebase.json` if needed
- **Authentication Issues**: Double-check your API credentials and base URL

## Costs

- Firebase Functions has a generous free tier (2 million invocations/month)
- Monitor usage in the [Firebase Console](https://console.firebase.google.com/)

## Security Notes

- Never commit sensitive information to version control
- Use Firebase's built-in secret management for sensitive data
- Review and set appropriate Firebase Security Rules
