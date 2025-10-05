# Keep-Alive Service - Deployment Guide

This guide explains how to run the Keep-Alive Service as a standalone Node.js application or inside a container.

## Prerequisites

1. Install Node.js (v16 or later)
2. Install dependencies:
   ```powershell
   cd functions
   npm install
   ```

## Running locally

1. Build the TypeScript code:
   ```powershell
   cd functions
   npm run build
   ```
2. Start the service (from project root):
   ```powershell
   node index.js
   ```

The service exposes a health endpoint at `http://localhost:3000/health` (or the port set in `PORT`).

## Environment variables

The service requires the following environment variables to be set (for HTTP/scheduled mode):

- `API_BASE_URL` (required)
- `API_USERNAME` or `KEEP_ALIVE_EMAIL` (depending on which entrypoint you use)
- `API_PASSWORD` or `KEEP_ALIVE_PASSWORD`
- `KEEP_ALIVE_INTERVAL` (optional, milliseconds; default ~12 minutes)
- `PORT` (optional, for HTTP server)

## Docker / Container

Build and run with your preferred container tooling. Ensure env vars are provided to the container at runtime.

## Notes

- The project no longer depends on Firebase; it runs as a standalone service or inside a container.
- Keep secrets out of version control. Use your platform's secret manager for production.
