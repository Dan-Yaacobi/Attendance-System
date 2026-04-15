# QR Attendance System

## 1. Project Overview
This project scaffolds a QR-based attendance system where participants scan a QR code to access an attendance flow. The backend will validate session context, verify participant/device details, and record attendance events. An admin panel will support authentication, session management, and review of attendance and audit activity.

High-level flow:
- QR scan initiates attendance entry.
- Session validation confirms attendance context.
- Attendance is marked and stored.
- Admin panel is used for oversight and control.

## 2. Tech Stack
- **Frontend:** React (Vite)
- **Backend:** Node.js + Express
- **Database:** PostgreSQL (`pg`, raw SQL)
- **Deployment target:** Vercel (frontend) + Nexus (backend)

## 3. Architecture Overview
- **Frontend (`/frontend`)**
  - Lightweight React app generated with a minimal Vite-style structure.
  - Responsible for user-facing attendance interactions and future admin UI pages.
- **Backend (`/backend`)**
  - Express API with modular route, middleware, service, and validator folders.
  - Centralized API namespace (`/api/v1`) and shared error handling.
- **Database (PostgreSQL)**
  - Accessed through `pg` with a shared query utility.
  - Raw SQL approach keeps control explicit and transparent.

This simple architecture was chosen to keep the scaffold clean, easy to evolve, and straightforward to deploy across separate frontend/backend targets.

## 4. Key Features
- QR-based attendance
- Session validation
- Participant verification
- Device UUID system
- Admin panel
- Audit logs
- Secure cookie-based admin sessions

## 5. Project Structure
```text
/frontend
  /src
    App.jsx
    api.js
    main.jsx
  .env.example
  index.html
  package.json
  vite.config.js

/backend
  /db
    index.js
  /routes
    index.js
    attendance.routes.js
    admin.routes.js
  /services
    session.service.js
    participant.service.js
    attendance.service.js
    device.service.js
    audit.service.js
  /middleware
    error.middleware.js
    auth.middleware.js
  /validators
    attendance.validator.js
    admin.validator.js
  .env.example
  package.json
  server.js
```

## 6. Setup Instructions

### Backend
```bash
cd backend
npm install
npm run dev
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

## 7. Environment Variables
### Backend (`/backend/.env`)
- `DATABASE_URL`: PostgreSQL connection string.
- `PORT`: Backend server port (default: `4000`).
- `CORS_ALLOWED_ORIGIN`: Allowed frontend origin(s) for CORS. Use a comma-separated list when needed.
- `BCRYPT_ROUNDS`: Password hashing cost factor (recommended `12`).
- `NODE_ENV`: Set to `production` in deployed environments.
- `SESSION_COOKIE_NAME`: Name of admin session cookie (default: `admin_session`).
- `ADMIN_SESSION_TTL_HOURS`: Admin session time-to-live in hours (default: `24`).

### Frontend (`/frontend/.env`)
- `VITE_API_BASE_URL`: Base URL for frontend API requests.

## 8. Future Improvements
- QR token security
- Rate limiting
- Better admin UX

## 9. Database Setup
- Create a PostgreSQL database for the backend.
- Set `DATABASE_URL` in `backend/.env` to your database connection string.
- Run migrations:
  ```bash
  cd backend
  npm run migrate
  ```

Migrations are versioned SQL files that define schema changes over time. They are used to keep database structure consistent across environments and to apply changes safely in order.

## 10. Admin Authentication (Cookie Session)

- Admin login (`POST /api/v1/admin/auth/login`) validates credentials with `bcrypt.compare`.
- On success, backend creates an `admin_sessions` DB record and sets an **httpOnly** session cookie.
- Cookie settings:
  - `httpOnly: true`
  - `path: /`
  - `sameSite: lax`
  - `secure: true` only when `NODE_ENV=production`
  - `maxAge`: controlled by `ADMIN_SESSION_TTL_HOURS`
- Admin API routes are protected server-side via `requireAdminAuth`, which reads only from cookies.
- Frontend never stores admin tokens in `localStorage` or `sessionStorage`.
- Session restore on refresh uses `GET /api/v1/admin/auth/me`.
- Logout (`POST /api/v1/admin/auth/logout`) revokes the server session and clears the cookie.

### Local development vs production

- Local dev (`NODE_ENV=development`): cookie is still httpOnly but not `secure`, so login works on localhost over HTTP.
- Production (e.g., Vercel + HTTPS): cookie is marked `secure`; transport is encrypted by HTTPS and cookie flags provide browser-level protections.
- For cookie auth to work, backend CORS must use explicit origin(s) and `credentials: true`, and frontend requests must include credentials.
