# Keep-Alive Service

This repository contains a small Node.js service that keeps a remote backend active by periodically performing authenticated requests. The service includes logging, retries, and a small HTTP health endpoint so you can monitor status.

This project was previously organized as a Firebase Functions subproject; it has been consolidated into a single runnable application at the repository root.

Contents
- `index.js` — main service and HTTP/health server
- `package.json` — root package manifest (dependencies & scripts)
- `DEPLOYMENT.md` — how to run/deploy

What the application does (step-by-step)
1. Startup
   - `index.js` reads environment variables (via `dotenv` if present).
   - Logger is configured (Console + daily rotate files).
   - The HTTP server (Express) is started on `PORT` (default 3000).

2. Initial keep-alive cycle
   - On startup the service immediately runs one keep-alive cycle.
   - A keep-alive cycle does:
     a. If not currently authenticated, perform login by POSTing to `API_BASE_URL/api/auth/login` with credentials.
     b. On successful login, store cookies for authenticated requests.
     c. Perform an authenticated GET to `API_BASE_URL/api/user/me` (or equivalent) to verify the session.
     d. If successful, mark the run as successful; on error it increments failure counters and triggers re-login when necessary.

3. Recurring runs
   - The keep-alive cycle is scheduled with a configurable interval: `KEEP_ALIVE_INTERVAL` (milliseconds). Default is ~12 minutes.
   - Each run logs duration, success/failure, and updates `lastRunTime` / `nextRunTime` state.

4. Manual triggering & health
   - The app exposes a health endpoint at `/health` that returns:
     - service status, uptime, memory usage
     - last run time, next run time, failed run count, last error
   - There is also a simple root `GET /` and `GET /ping` endpoints.

5. Shutdown handling
   - On SIGINT/SIGTERM the app will attempt a graceful shutdown and attempt a final logout if logged in.

Environment variables (important)
- `API_BASE_URL` (required) — base URL of the backend to ping
- `API_USERNAME` / `KEEP_ALIVE_EMAIL` (required) — username/email for login
- `API_PASSWORD` / `KEEP_ALIVE_PASSWORD` (required) — password for login
- `KEEP_ALIVE_INTERVAL` (optional) — milliseconds between runs (default ~12 minutes)
- `PORT` (optional) — port for the health/HTTP server (default: 3000)
- `LOG_LEVEL` (optional) — winston log level (info, debug, etc.)
 - `ALERT_EMAIL` (optional) — recipient email to notify when max login attempts are reached
 - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` (optional) — SMTP server credentials used to send alert emails
 - `SMTP_FROM` (optional) — optional from address for alert emails (defaults to SMTP_USER)
 - `ALERT_COOLDOWN_MS` (optional) — minimum milliseconds between alert emails (default: 60000 = 1 minute)

Behavior notes:
- When the service fails to login after `maxAttempts` (default 10), it will send a single alert email (if configured).
- To avoid email storms, alerts are throttled by `ALERT_COOLDOWN_MS`. The service will still continue attempting login cycles after alerting.

How the authentication & request flow works
- Login: POST to `${API_BASE_URL}/api/auth/login` with { username/password }.
- The server should return a successful response and set a session cookie via `Set-Cookie`.
- The service stores the cookie string and sends it with subsequent requests.
- Requests: GET `${API_BASE_URL}/api/user/me` to validate the session.
- Logout: POST to `${API_BASE_URL}/api/auth/logout` when requested (or before shutdown).

Running the service locally
1. Install dependencies:
```powershell
npm install
```
2. Create a `.env` file (or set env vars directly):
```env
API_BASE_URL=https://your-backend.example.com
API_USERNAME=your_user
API_PASSWORD=your_password
KEEP_ALIVE_INTERVAL=720000
PORT=3000
LOG_LEVEL=info
```
3. Run (development):
```powershell
npm run dev
```
4. Run (production):
```powershell
npm start
```

Quick test
- After starting, visit `http://localhost:3000/health` to verify the service is UP and to inspect run statistics.

Cleaning and maintenance
- To prune and refresh installed packages:
```powershell
Remove-Item -Recurse -Force node_modules
npm install
```

License: MIT
