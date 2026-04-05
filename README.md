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
cp .env.example .env
npm run dev
```

### Frontend
```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

## 7. Environment Variables
### Backend (`/backend/.env`)
- `DATABASE_URL`: PostgreSQL connection string.
- `PORT`: Backend server port (default: `4000`).
- `CORS_ALLOWED_ORIGIN`: Allowed frontend origin for CORS.
- `BCRYPT_ROUNDS`: Password hashing cost factor.
- `SESSION_COOKIE_NAME`: Name of admin session cookie.
- `SESSION_COOKIE_SECURE`: Whether cookie uses secure flag (`true/false`).
- `ADMIN_SESSION_TTL_HOURS`: Admin session time-to-live in hours.

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
