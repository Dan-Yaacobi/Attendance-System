# PROJECT_DESIGN.md

## 1. High-Level Architecture

This system is a simple fullstack attendance platform where users scan a QR code for a course and the backend records attendance if they are eligible.

### Frontend (React)
- Runs as a static web app on **Vercel**.
- Provides:
  - Public attendance flow pages (QR landing, sign-in form, status page).
  - Admin panel pages (courses, participants, attendance management).
- Stores `participant_uid` in `localStorage` for returning users.
- Calls backend REST APIs over HTTPS.

### Backend (Node.js + Express)
- Runs on **Nexus**.
- Responsibilities:
  - Validate course and participant eligibility.
  - Create and validate participant device identity (`participant_uid`).
  - Create attendance records with duplicate protection.
  - Admin authentication and protected admin APIs.
- Uses `pg` for direct SQL queries to PostgreSQL.

### Database (PostgreSQL)
- Source of truth for:
  - Courses (including SAP identifier).
  - Participants and course assignments.
  - Device identities (`participant_uid`).
  - Attendance entries.
  - Admin accounts and sessions.
- Enforces data integrity through foreign keys, unique constraints, and indexes.

### End-to-End Request Flow
1. User scans course QR code.
2. React route reads course identifier from URL.
3. Frontend checks `localStorage.participant_uid`.
4. If present, frontend calls backend to validate identity + assignment + record attendance.
5. If missing/invalid, frontend shows sign-in form (name, phone, email).
6. Backend verifies user assignment for that course.
7. Backend creates/updates participant identity, returns `participant_uid`, and inserts attendance.
8. Frontend stores `participant_uid` and shows attendance success/failure.
9. Admin users login and manage courses/participants/attendance via protected endpoints.

---

## 2. Data Model (VERY IMPORTANT)

Below is a PostgreSQL schema designed to keep logic simple and strongly consistent.

### 2.1 `courses`
Represents each course with a unique SAP identifier.

```sql
CREATE TABLE courses (
  id BIGSERIAL PRIMARY KEY,
  sap_identifier VARCHAR(64) NOT NULL UNIQUE,
  code VARCHAR(32) NOT NULL,
  title VARCHAR(255) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 2.2 `participants`
Canonical participant profile.

```sql
CREATE TABLE participants (
  id BIGSERIAL PRIMARY KEY,
  full_name VARCHAR(150) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(30) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT participants_email_lower_uniq UNIQUE (LOWER(email)),
  CONSTRAINT participants_phone_uniq UNIQUE (phone)
);
```

### 2.3 `course_participants`
Assignment table: which participant is allowed in which course.

```sql
CREATE TABLE course_participants (
  id BIGSERIAL PRIMARY KEY,
  course_id BIGINT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  participant_id BIGINT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT course_participant_unique UNIQUE (course_id, participant_id)
);
```

### 2.4 `participant_devices`
Stores unique persistent IDs returned to frontend and saved in localStorage.

```sql
CREATE TABLE participant_devices (
  participant_uid UUID PRIMARY KEY,
  participant_id BIGINT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX idx_participant_devices_participant_id
  ON participant_devices(participant_id);
```

### 2.5 `attendance_records`
Stores each attendance event.

```sql
CREATE TABLE attendance_records (
  id BIGSERIAL PRIMARY KEY,
  course_id BIGINT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  participant_id BIGINT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  attendance_date DATE NOT NULL,
  checked_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source VARCHAR(20) NOT NULL DEFAULT 'qr',
  removed_by_admin_id BIGINT NULL,
  removed_at TIMESTAMPTZ NULL,
  CONSTRAINT attendance_unique_per_day UNIQUE (course_id, participant_id, attendance_date)
);

CREATE INDEX idx_attendance_course_date
  ON attendance_records(course_id, attendance_date);
```

> `attendance_unique_per_day` is the key anti-duplication rule: one participant can only be marked once per course per date.

### 2.6 `admin_users`
Simple admin login accounts.

```sql
CREATE TABLE admin_users (
  id BIGSERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 2.7 `admin_sessions`
Server-managed session tokens for admin panel.

```sql
CREATE TABLE admin_sessions (
  id BIGSERIAL PRIMARY KEY,
  admin_user_id BIGINT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  session_token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ NULL
);

CREATE INDEX idx_admin_sessions_admin_user_id
  ON admin_sessions(admin_user_id);
```

### Relationship Summary
- `courses` 1—N `course_participants`
- `participants` 1—N `course_participants`
- `participants` 1—N `participant_devices`
- `courses` 1—N `attendance_records`
- `participants` 1—N `attendance_records`
- `admin_users` 1—N `admin_sessions`

---

## 3. API Design

Base URL example: `/api/v1`

All responses include JSON with either `{ success: true, data: ... }` or `{ success: false, error: ... }`.

### 3.1 Auth Routes (Admin)

#### `POST /api/v1/admin/auth/login`
- **Purpose:** Admin login.
- **Request body:**
  ```json
  { "email": "admin@domain.com", "password": "plaintext-password" }
  ```
- **Response (200):**
  ```json
  { "success": true, "data": { "adminId": 1 } }
  ```
- **Behavior:**
  - Verify password using bcrypt hash.
  - Create random session token.
  - Store **hashed token** in `admin_sessions`.
  - Return token in `HttpOnly` secure cookie.

#### `POST /api/v1/admin/auth/logout`
- **Purpose:** End admin session.
- **Request body:** none.
- **Response:** `{ "success": true }`
- **Behavior:** Revoke current session (`revoked_at`).

#### `GET /api/v1/admin/auth/me`
- **Purpose:** Validate current admin session.
- **Response:**
  ```json
  { "success": true, "data": { "adminId": 1, "email": "admin@domain.com" } }
  ```

### 3.2 Attendance & User Identification Routes

#### `POST /api/v1/attendance/check-in-with-uid`
- **Purpose:** Returning user attendance attempt using localStorage `participant_uid`.
- **Request body:**
  ```json
  {
    "courseSapIdentifier": "SAP-COURSE-123",
    "participantUid": "uuid-value"
  }
  ```
- **Response (success):**
  ```json
  {
    "success": true,
    "data": {
      "attendanceRecorded": true,
      "alreadyMarkedToday": false,
      "attendanceDate": "2026-04-05"
    }
  }
  ```
- **Failure cases:** invalid UID, not assigned, inactive course, duplicate today.

#### `POST /api/v1/attendance/check-in-with-signin`
- **Purpose:** New/forced re-login flow.
- **Request body:**
  ```json
  {
    "courseSapIdentifier": "SAP-COURSE-123",
    "fullName": "Jane Doe",
    "email": "jane@mail.com",
    "phone": "+15551234567"
  }
  ```
- **Response (success):**
  ```json
  {
    "success": true,
    "data": {
      "participantUid": "generated-uuid",
      "attendanceRecorded": true,
      "alreadyMarkedToday": false,
      "attendanceDate": "2026-04-05"
    }
  }
  ```
- **Behavior:**
  1. Find participant by normalized email/phone.
  2. Validate assignment to course.
  3. Create UID in `participant_devices` (or rotate/create new UID if needed).
  4. Insert attendance (idempotent using unique constraint).

#### `POST /api/v1/participants/resolve-uid`
- **Purpose:** Validate a stored UID and fetch minimal profile.
- **Request body:**
  ```json
  { "participantUid": "uuid-value" }
  ```
- **Response:** participant summary or invalid.
- **Use case:** frontend startup check before attempting auto check-in.

### 3.3 Course Routes

#### `GET /api/v1/courses/public/:sapIdentifier`
- **Purpose:** Public course existence + active status for QR landing page.
- **Response:**
  ```json
  {
    "success": true,
    "data": { "sapIdentifier": "SAP-COURSE-123", "title": "Database Systems", "isActive": true }
  }
  ```

#### `GET /api/v1/admin/courses`
- **Auth:** admin required.
- **Purpose:** List all courses.

#### `GET /api/v1/admin/courses/:courseId/participants`
- **Auth:** admin required.
- **Purpose:** View participants assigned to one course.

#### `PATCH /api/v1/admin/courses/:courseId/participants/:participantId`
- **Auth:** admin required.
- **Purpose:** Edit participant details/assignment flags.
- **Request body example:**
  ```json
  { "fullName": "Updated Name", "phone": "+15550000000" }
  ```

#### `POST /api/v1/admin/courses/:courseId/participants`
- **Auth:** admin required.
- **Purpose:** Assign participant to a course.

#### `DELETE /api/v1/admin/courses/:courseId/participants/:participantId`
- **Auth:** admin required.
- **Purpose:** Remove participant assignment from course.

### 3.4 Attendance Admin Routes

#### `GET /api/v1/admin/attendance`
- **Auth:** admin required.
- **Query params:** `courseId`, `dateFrom`, `dateTo`, `participantEmail` (optional filters).
- **Purpose:** Attendance listing/reporting.

#### `DELETE /api/v1/admin/attendance/:attendanceId`
- **Auth:** admin required.
- **Purpose:** Remove incorrect attendance entries.
- **Behavior:** soft-delete by setting `removed_at` and `removed_by_admin_id` (preferred for audit).

---

## 4. Authentication Design

### Admin Authentication (Simple but Secure)
- Admin logs in with email/password.
- Passwords are stored as bcrypt hashes (`password_hash`).
- On successful login:
  - Server creates a high-entropy random token.
  - Store **hash of token** in `admin_sessions` with expiry (e.g., 7 days).
  - Send raw token in `HttpOnly`, `Secure`, `SameSite=Strict` cookie.
- For each protected admin request:
  - Read cookie token.
  - Hash it and match active non-expired session row.

### Why This Approach
- Simpler than full OAuth/JWT infrastructure.
- Secure enough for internal admin panel.
- Session revocation is straightforward (`revoked_at`).
- Keeps auth logic in one place with plain SQL.

---

## 5. QR Code Logic

### QR Payload
Use URL only, for example:

`https://attendance.example.com/scan?course=SAP-COURSE-123`

### Why only course identifier in QR
- Keeps QR code stable and easy to regenerate.
- No personally identifiable information in QR.
- No secret embedded, so leakage risk is low.

### Security Considerations
- Server never trusts QR alone; it always validates participant assignment.
- Optional lightweight protection: include short static course access token in query and verify server-side.
- Rate-limit attendance endpoints by IP + course to reduce abuse.

---

## 6. Attendance Logic

### 6.1 New User Flow
1. User scans QR and opens scan page.
2. Frontend reads `course` from URL.
3. `localStorage.participant_uid` missing → show sign-in form.
4. User submits name, email, phone.
5. Backend normalizes values (trim/lowercase email, canonical phone).
6. Backend finds participant and confirms assignment in `course_participants`.
7. If valid, backend creates `participant_uid` record in `participant_devices`.
8. Backend inserts attendance row with `attendance_date = CURRENT_DATE`.
9. Backend returns `participant_uid` and attendance status.
10. Frontend stores UID and shows success.

### 6.2 Returning User Flow
1. Frontend finds `participant_uid` in localStorage.
2. Calls `/attendance/check-in-with-uid`.
3. Backend validates UID exists and is active.
4. Backend resolves `participant_id` from UID.
5. Backend verifies assignment to scanned course.
6. Backend inserts attendance row for today.
7. If unique constraint conflict occurs, return `alreadyMarkedToday: true`.

### 6.3 Invalid ID Flow
If UID is missing/invalid/mismatched:
- Backend returns `INVALID_UID`.
- Frontend clears localStorage UID and redirects to sign-in flow.

### Duplicate Prevention
- Primary guarantee: DB unique constraint `(course_id, participant_id, attendance_date)`.
- API uses insert pattern:
  ```sql
  INSERT INTO attendance_records (...) VALUES (...)
  ON CONFLICT (course_id, participant_id, attendance_date)
  DO NOTHING;
  ```
- Response indicates whether insert happened.

---

## 7. Edge Cases Handling

### User deletes localStorage
- App behaves like first-time user.
- Sign-in revalidates assignment.
- New UID may be issued.
- Attendance still protected from duplicates by DB constraint.

### User switches device
- Old UID unavailable on new device.
- User signs in again with name/email/phone.
- If assigned, backend issues new UID linked to same participant.

### User not assigned to course
- Sign-in or UID check-in returns `NOT_ASSIGNED_TO_COURSE`.
- Frontend shows clear error and no attendance record is created.

### Concurrent check-ins
- Multiple fast requests from same user/course/day can happen.
- DB unique constraint resolves race safely.
- At most one row is inserted; other requests return already-marked state.

---

## 8. Admin Panel Design

### Core Pages / Components (React)
1. **AdminLoginPage**
   - Email/password form.
   - Calls `/admin/auth/login`.

2. **AdminLayout**
   - Protected shell with top nav + logout.
   - Calls `/admin/auth/me` on load.

3. **CoursesPage**
   - Table of all courses.
   - Link to participants + attendance views.

4. **CourseParticipantsPage**
   - Participant list for selected course.
   - Add/edit/remove assignment actions.

5. **AttendancePage**
   - Filterable attendance list.
   - Remove attendance action with confirmation.

### Data Flow
- React components call backend REST endpoints.
- Admin auth state is cookie-based; frontend does not manage raw tokens.
- On 401 response, redirect to login.

### Key Features
- Replace Google Sheets with relational records.
- Single source of truth for roster + attendance.
- Immediate correction tools (edit participant, remove attendance).

---

## 9. Deployment Architecture

### Vercel (Frontend)
- Hosts React SPA static assets.
- Environment variables:
  - `VITE_API_BASE_URL` (e.g., `https://api.attendance.example.com/api/v1`)

### Nexus (Backend)
- Hosts Express API.
- Environment variables:
  - `PORT`
  - `NODE_ENV`
  - `DATABASE_URL`
  - `ADMIN_SESSION_TTL_HOURS`
  - `SESSION_COOKIE_NAME`
  - `SESSION_COOKIE_SECURE=true`
  - `BCRYPT_ROUNDS`
  - `CORS_ALLOWED_ORIGIN` (Vercel frontend URL)

### PostgreSQL
- Managed instance accessible by backend.
- TLS enabled for production connection.
- Daily backups recommended.

### Networking Notes
- Frontend only talks to backend over HTTPS.
- Backend only talks to PostgreSQL over secure connection.

---

## 10. Tradeoffs & Design Decisions

### Why no ORM
- Requirement is strict use of simple SQL + `pg`.
- Direct SQL is easy to reason about for this scope.
- Lower abstraction means fewer hidden queries and easier debugging.

### Why simple admin auth (session cookie)
- Internal admin panel does not require external identity provider.
- Server-side session revocation is straightforward.
- `HttpOnly` cookie reduces token theft via XSS compared to localStorage tokens.

### Why this data model
- Many-to-many mapping (`course_participants`) cleanly models assignment.
- `participant_devices` isolates device/localStorage identity from core participant record.
- Attendance uniqueness is enforced at DB layer, not only application layer.

### Why this API structure
- Separate public attendance endpoints from admin endpoints.
- Public endpoints are focused and minimal.
- Admin endpoints are CRUD/reporting oriented.

### Future Improvements (without changing current simplicity)
1. Add admin audit log table for all changes.
2. Add participant import endpoint (CSV upload) for bulk assignment.
3. Add course-level attendance windows (start/end time).
4. Add analytics endpoints (attendance percentage per course).
5. Add optional QR signature to reduce tampered links.

This design remains production-ready while keeping implementation simple for a small team and easy to explain by junior developers.
