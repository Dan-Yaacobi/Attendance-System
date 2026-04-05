# PROJECT_DESIGN.md

## 1. Purpose and Scope

This document defines the **implementation-ready design** for a QR-based attendance system with the following fixed stack:

- **Frontend:** React
- **Backend:** Node.js + Express
- **Database:** PostgreSQL
- **Database access:** `pg` with raw SQL
- **Deployment:** Vercel (frontend) + Nexus (backend)

This design is intentionally strict and deterministic so the full flow is easy to implement, test, and explain.

---

## 2. Non-Negotiable Rules

### 2.1 QR Logic
QR payload contains **only** `course_id` (SAP identifier string). No participant info, no tokens in core flow.

On QR access, backend must execute in this order:
1. Validate course exists.
2. Validate there is a session **today** for this course.
3. If no session today, reject immediately and stop flow.

### 2.2 Attendance Model
Attendance is **session-based** (not course-based).

- Attendance record must reference `session_id`.
- Duplicate prevention must be DB-enforced with:
  - `UNIQUE (session_id, participant_id)`

### 2.3 Participant Truth Source
Participants are pre-registered through admin panel before course starts.

- Assignment is course-specific.
- Only assigned participants can mark attendance for sessions of that course.

### 2.4 Participant Matching (Strict)
Sign-in matching order:
1. Normalize phone and email.
2. Attempt match by phone.
3. If no phone match, attempt match by email.
4. If phone and email match different participants, reject with conflict error.
5. Name is informational only and is not used for matching.

### 2.5 Device UUID System
- Frontend stores a device UUID in `localStorage`.
- UUIDs are mapped in `participant_devices`.
- Multiple devices per participant are allowed.
- Invalid UUID requires forced re-login.
- New login creates a **new** `participant_devices` row (never overwrite existing rows).

### 2.6 Admin Panel Scope
Admin panel is a full management system and must include:
- Admin authentication
- Course management
- Session management
- Participant assignment per course
- Attendance viewing
- Attendance correction/removal
- Manual attendance entry
- Audit logs

---

## 3. Repository Structure (Strict)

```text
/frontend
/backend
  /routes
  /db
  /services
  /middleware
  /validators
```

Recommended file allocation:

- `/backend/routes`: Express route modules (public + admin).
- `/backend/db`: SQL query files or query helper modules using `pg`.
- `/backend/services`: business rules (session validation, attendance write logic, audit logging).
- `/backend/middleware`: auth middleware, error middleware, request context.
- `/backend/validators`: request schema checks and normalization helpers.

---

## 4. PostgreSQL Data Model (Final)

## 4.1 Table: `courses`
Represents course catalog records keyed by SAP identifier.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGSERIAL | PK | Internal key |
| course_id | VARCHAR(64) | NOT NULL, UNIQUE | SAP identifier used in QR |
| course_code | VARCHAR(32) | NOT NULL | Human-readable code |
| course_name | VARCHAR(255) | NOT NULL | Display name |
| is_active | BOOLEAN | NOT NULL DEFAULT TRUE | Soft active state |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |

Indexes:
- Unique index on `course_id`.
- Index on `is_active`.

## 4.2 Table: `course_sessions`
Required table for session-based attendance.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGSERIAL | PK | Session key |
| course_id | BIGINT | NOT NULL, FK -> courses(id) ON DELETE CASCADE | Parent course |
| session_date | DATE | NOT NULL | Date used for "today session" validation |
| start_time | TIME | NULL | Optional |
| end_time | TIME | NULL | Optional |
| is_cancelled | BOOLEAN | NOT NULL DEFAULT FALSE | Excludes session from attendance |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |

Constraints:
- `CHECK (end_time IS NULL OR start_time IS NULL OR end_time > start_time)`
- `UNIQUE (course_id, session_date, start_time)` to prevent duplicate definitions.

Indexes:
- `(course_id, session_date)` for QR/day lookup.
- Partial index on `(course_id, session_date)` where `is_cancelled = FALSE`.

## 4.3 Table: `participants`
Canonical participant profiles.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGSERIAL | PK | |
| full_name | VARCHAR(150) | NOT NULL | Informational for UI |
| email | VARCHAR(255) | NOT NULL | Raw input retained |
| email_normalized | VARCHAR(255) | NOT NULL | Lowercased + trimmed |
| phone | VARCHAR(32) | NOT NULL | Raw input retained |
| phone_normalized | VARCHAR(32) | NOT NULL | Canonical digits/format |
| is_active | BOOLEAN | NOT NULL DEFAULT TRUE | |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |

Constraints:
- `UNIQUE (email_normalized)`
- `UNIQUE (phone_normalized)`

Indexes:
- Index on `is_active`.

## 4.4 Table: `course_participants`
Course assignment bridge (truth source for eligibility).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGSERIAL | PK | |
| course_id | BIGINT | NOT NULL, FK -> courses(id) ON DELETE CASCADE | |
| participant_id | BIGINT | NOT NULL, FK -> participants(id) ON DELETE CASCADE | |
| assigned_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |
| assigned_by_admin_id | BIGINT | FK -> admins(id) ON DELETE SET NULL | Auditable |

Constraints:
- `UNIQUE (course_id, participant_id)`

Indexes:
- `(participant_id, course_id)`

## 4.5 Table: `participant_devices`
Maps frontend UUIDs to participant records.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGSERIAL | PK | |
| device_uuid | UUID | NOT NULL, UNIQUE | Stored in localStorage |
| participant_id | BIGINT | NOT NULL, FK -> participants(id) ON DELETE CASCADE | |
| first_seen_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |
| last_seen_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | Updated at successful use |
| is_revoked | BOOLEAN | NOT NULL DEFAULT FALSE | Invalidates UUID |
| created_via_course_id | BIGINT | FK -> courses(id) ON DELETE SET NULL | provenance |

Indexes:
- `(participant_id, is_revoked)`
- `(device_uuid, is_revoked)`

## 4.6 Table: `attendance_records`
Session-based attendance events.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGSERIAL | PK | |
| session_id | BIGINT | NOT NULL, FK -> course_sessions(id) ON DELETE CASCADE | required |
| participant_id | BIGINT | NOT NULL, FK -> participants(id) ON DELETE CASCADE | |
| marked_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |
| source | VARCHAR(20) | NOT NULL | `qr` or `admin_manual` |
| device_uuid | UUID | NULL | for QR flows |
| status | VARCHAR(20) | NOT NULL DEFAULT 'present' | currently present only |
| notes | TEXT | NULL | admin correction reason |
| removed_at | TIMESTAMPTZ | NULL | soft removal |
| removed_by_admin_id | BIGINT | NULL, FK -> admins(id) ON DELETE SET NULL | |

Constraints:
- `UNIQUE (session_id, participant_id)` (**required duplicate prevention**)
- `CHECK (source IN ('qr', 'admin_manual'))`
- `CHECK (status IN ('present'))`

Indexes:
- `(session_id, marked_at)`
- `(participant_id, marked_at DESC)`
- Partial index on `(session_id, participant_id)` where `removed_at IS NULL`

## 4.7 Table: `admins`
Admin identities for panel access.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGSERIAL | PK | |
| email | VARCHAR(255) | NOT NULL, UNIQUE | login identifier |
| password_hash | TEXT | NOT NULL | bcrypt hash |
| full_name | VARCHAR(120) | NOT NULL | display |
| role | VARCHAR(30) | NOT NULL DEFAULT 'admin' | role-based futureproofing |
| is_active | BOOLEAN | NOT NULL DEFAULT TRUE | |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |

## 4.8 Table: `admin_sessions`
Server-side admin auth sessions.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGSERIAL | PK | |
| admin_id | BIGINT | NOT NULL, FK -> admins(id) ON DELETE CASCADE | |
| session_token_hash | TEXT | NOT NULL, UNIQUE | hashed token in DB |
| issued_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |
| expires_at | TIMESTAMPTZ | NOT NULL | |
| revoked_at | TIMESTAMPTZ | NULL | |
| ip_address | INET | NULL | optional metadata |
| user_agent | TEXT | NULL | optional metadata |

Indexes:
- `(admin_id, expires_at)`
- Partial index where `revoked_at IS NULL`

## 4.9 Table: `admin_audit_logs`
Immutable admin action ledger.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGSERIAL | PK | |
| admin_id | BIGINT | NOT NULL, FK -> admins(id) ON DELETE RESTRICT | actor |
| action_type | VARCHAR(80) | NOT NULL | e.g., `COURSE_CREATE` |
| entity_type | VARCHAR(80) | NOT NULL | e.g., `course_sessions` |
| entity_id | BIGINT | NULL | target row id |
| request_id | UUID | NULL | traceability |
| old_values | JSONB | NULL | before state |
| new_values | JSONB | NULL | after state |
| metadata | JSONB | NOT NULL DEFAULT '{}'::jsonb | context |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |

Indexes:
- `(admin_id, created_at DESC)`
- `(entity_type, entity_id, created_at DESC)`
- `(action_type, created_at DESC)`

---

## 5. Core Backend Services

### 5.1 `SessionValidationService`
Input: `course_id` (SAP identifier).

Steps:
1. Resolve active course by `courses.course_id`.
2. Resolve session for current date from `course_sessions` where:
   - `course_id = resolved_course.id`
   - `session_date = CURRENT_DATE`
   - `is_cancelled = FALSE`
3. If no matching row, return `NO_SESSION_TODAY` and stop.

Output:
- `course`
- `session`

### 5.2 `ParticipantResolutionService`
Input from sign-in: `full_name`, `email`, `phone`, `course_id`.

Steps:
1. Normalize email and phone.
2. Query by normalized phone.
3. If not found, query by normalized email.
4. If phone and email resolve to different participant IDs, return `PARTICIPANT_IDENTITY_CONFLICT`.
5. Verify resolved participant is assigned in `course_participants` for course.
6. If not assigned, return `NOT_ASSIGNED_TO_COURSE`.

Output:
- `participant`

### 5.3 `DeviceService`
- Validate incoming UUID in `participant_devices` and check `is_revoked = FALSE`.
- On successful sign-in, insert a new `participant_devices` row with new UUID.
- Never update existing row’s `device_uuid`.

### 5.4 `AttendanceService`
- Insert `attendance_records` with `session_id`, `participant_id`, `source`, `device_uuid`.
- Use DB uniqueness `UNIQUE (session_id, participant_id)` as final dedupe guard.
- If conflict, return `ALREADY_MARKED`.

### 5.5 `AuditLogService`
- Called by every admin mutating endpoint.
- Writes `admin_audit_logs` row in same transaction as data change.

---

## 6. API Design (Complete)

Base path: `/api/v1`

Response envelope:

```json
{ "success": true, "data": {} }
```
or
```json
{ "success": false, "error": { "code": "ERROR_CODE", "message": "Readable message" } }
```

### 6.1 Public Attendance Endpoints

#### 6.1.1 Validate QR / session entry point
- **Method:** `POST`
- **Route:** `/api/v1/attendance/entry`
- **Purpose:** Initial backend validation from QR payload.
- **Request:**
  ```json
  { "course_id": "SAP-COURSE-1001" }
  ```
- **Success response:**
  ```json
  {
    "success": true,
    "data": {
      "course": { "id": 12, "course_id": "SAP-COURSE-1001", "course_name": "Database Systems" },
      "session": { "id": 941, "session_date": "2026-04-05", "start_time": "09:00:00", "end_time": "11:00:00" }
    }
  }
  ```
- **Failure codes:** `COURSE_NOT_FOUND`, `COURSE_INACTIVE`, `NO_SESSION_TODAY`.

#### 6.1.2 Returning user attendance by UUID
- **Method:** `POST`
- **Route:** `/api/v1/attendance/mark-by-device`
- **Purpose:** Fast path for previously logged-in participant.
- **Request:**
  ```json
  { "course_id": "SAP-COURSE-1001", "device_uuid": "uuid-string" }
  ```
- **Success response:**
  ```json
  {
    "success": true,
    "data": {
      "attendance": {
        "session_id": 941,
        "participant_id": 3002,
        "marked": true,
        "already_marked": false
      }
    }
  }
  ```
- **Failure codes:** `INVALID_DEVICE_UUID`, `NO_SESSION_TODAY`, `NOT_ASSIGNED_TO_COURSE`, `COURSE_NOT_FOUND`.

#### 6.1.3 Sign-in and mark attendance
- **Method:** `POST`
- **Route:** `/api/v1/attendance/sign-in`
- **Purpose:** New user or forced re-login path.
- **Request:**
  ```json
  {
    "course_id": "SAP-COURSE-1001",
    "full_name": "Alex Doe",
    "email": "alex@domain.com",
    "phone": "+1 (555) 111-2222"
  }
  ```
- **Success response:**
  ```json
  {
    "success": true,
    "data": {
      "device_uuid": "new-uuid",
      "participant_id": 3002,
      "session_id": 941,
      "marked": true,
      "already_marked": false
    }
  }
  ```
- **Failure codes:** `NO_SESSION_TODAY`, `PARTICIPANT_NOT_FOUND`, `PARTICIPANT_IDENTITY_CONFLICT`, `NOT_ASSIGNED_TO_COURSE`.

#### 6.1.4 Device UUID verification
- **Method:** `POST`
- **Route:** `/api/v1/attendance/verify-device`
- **Purpose:** Pre-flight UUID check before auto-mark.
- **Request:**
  ```json
  { "device_uuid": "uuid-string" }
  ```
- **Success response:**
  ```json
  { "success": true, "data": { "valid": true, "participant_id": 3002 } }
  ```
- **Failure codes:** `INVALID_DEVICE_UUID`.

### 6.2 Admin Authentication Endpoints

#### 6.2.1 Login
- **Method:** `POST`
- **Route:** `/api/v1/admin/auth/login`
- **Purpose:** Start admin session.
- **Request:** `{ "email": "admin@org.com", "password": "plaintext" }`
- **Response:** admin profile + HttpOnly session cookie.

#### 6.2.2 Logout
- **Method:** `POST`
- **Route:** `/api/v1/admin/auth/logout`
- **Purpose:** Revoke active session.

#### 6.2.3 Current admin
- **Method:** `GET`
- **Route:** `/api/v1/admin/auth/me`
- **Purpose:** Validate current cookie session and return admin identity.

### 6.3 Admin Course Management

#### 6.3.1 Create course
- **Method:** `POST`
- **Route:** `/api/v1/admin/courses`
- **Purpose:** Add course.

#### 6.3.2 List courses
- **Method:** `GET`
- **Route:** `/api/v1/admin/courses`
- **Purpose:** Paginated course list with filters.

#### 6.3.3 Get course detail
- **Method:** `GET`
- **Route:** `/api/v1/admin/courses/:courseId`
- **Purpose:** Single course data.

#### 6.3.4 Update course
- **Method:** `PATCH`
- **Route:** `/api/v1/admin/courses/:courseId`
- **Purpose:** Edit metadata/active flag.

#### 6.3.5 Delete/deactivate course
- **Method:** `DELETE`
- **Route:** `/api/v1/admin/courses/:courseId`
- **Purpose:** Controlled removal or deactivation policy.

### 6.4 Admin Session Management

#### 6.4.1 Create session
- **Method:** `POST`
- **Route:** `/api/v1/admin/courses/:courseId/sessions`
- **Purpose:** Add course session row.

#### 6.4.2 List sessions for course
- **Method:** `GET`
- **Route:** `/api/v1/admin/courses/:courseId/sessions`
- **Purpose:** View schedule.

#### 6.4.3 Update session
- **Method:** `PATCH`
- **Route:** `/api/v1/admin/sessions/:sessionId`
- **Purpose:** Change date/time/cancel flag.

#### 6.4.4 Delete session
- **Method:** `DELETE`
- **Route:** `/api/v1/admin/sessions/:sessionId`
- **Purpose:** Remove invalid session.

### 6.5 Admin Participant Assignment

#### 6.5.1 Create participant
- **Method:** `POST`
- **Route:** `/api/v1/admin/participants`
- **Purpose:** Add participant to master table.

#### 6.5.2 List participants
- **Method:** `GET`
- **Route:** `/api/v1/admin/participants`
- **Purpose:** Search by name/email/phone.

#### 6.5.3 Update participant
- **Method:** `PATCH`
- **Route:** `/api/v1/admin/participants/:participantId`
- **Purpose:** Correct profile data.

#### 6.5.4 Assign participant to course
- **Method:** `POST`
- **Route:** `/api/v1/admin/courses/:courseId/participants`
- **Purpose:** Add assignment.

#### 6.5.5 Remove participant from course
- **Method:** `DELETE`
- **Route:** `/api/v1/admin/courses/:courseId/participants/:participantId`
- **Purpose:** Remove assignment.

#### 6.5.6 List assigned participants
- **Method:** `GET`
- **Route:** `/api/v1/admin/courses/:courseId/participants`
- **Purpose:** Course roster view.

### 6.6 Admin Attendance Management

#### 6.6.1 List attendance
- **Method:** `GET`
- **Route:** `/api/v1/admin/attendance`
- **Purpose:** Filterable attendance table.
- **Query params:** `course_id`, `session_date`, `participant_id`, pagination.

#### 6.6.2 Manual attendance entry
- **Method:** `POST`
- **Route:** `/api/v1/admin/attendance/manual`
- **Purpose:** Admin marks participant present for a session.
- **Request:**
  ```json
  { "session_id": 941, "participant_id": 3002, "notes": "Late manual entry" }
  ```

#### 6.6.3 Remove/correct attendance
- **Method:** `DELETE`
- **Route:** `/api/v1/admin/attendance/:attendanceId`
- **Purpose:** Soft-remove incorrect attendance with reason.

### 6.7 Admin Audit Log Access

#### 6.7.1 List audit logs
- **Method:** `GET`
- **Route:** `/api/v1/admin/audit-logs`
- **Purpose:** Compliance and traceability view.

---

## 7. Attendance Flows (Step-by-Step)

### 7.1 New User Flow
1. User scans QR containing `course_id`.
2. Frontend calls `POST /attendance/entry`.
3. Backend validates course and today session.
4. If valid, frontend shows sign-in form.
5. User submits name/email/phone.
6. Backend normalizes email/phone.
7. Backend matches participant by strict rules.
8. Backend confirms participant assigned to course.
9. Backend creates new `device_uuid` row in `participant_devices`.
10. Backend inserts `attendance_records` with `session_id`.
11. Frontend stores new `device_uuid` in localStorage.
12. Success page shown.

### 7.2 Returning User Flow
1. User scans QR.
2. Frontend calls `/attendance/entry` first.
3. If session valid, frontend sends `/attendance/mark-by-device` using localStorage UUID.
4. Backend validates UUID and resolves participant.
5. Backend checks assignment to course.
6. Backend inserts attendance.
7. On unique conflict, return `already_marked=true`.
8. Frontend shows attendance status.

### 7.3 Invalid UUID Flow
1. UUID lookup fails or is revoked.
2. Backend returns `INVALID_DEVICE_UUID`.
3. Frontend clears localStorage UUID.
4. Frontend redirects to sign-in flow.
5. On successful sign-in, backend creates new device row and returns new UUID.

### 7.4 No Session Today Flow
1. QR scanned.
2. `/attendance/entry` validates course.
3. No session found for `CURRENT_DATE` (or session cancelled).
4. Backend returns `NO_SESSION_TODAY`.
5. Frontend shows non-actionable message; no sign-in and no attendance write.

### 7.5 User Not Assigned Flow
1. User reaches sign-in or UUID path.
2. Backend resolves participant identity.
3. `course_participants` lookup fails.
4. Backend returns `NOT_ASSIGNED_TO_COURSE`.
5. Frontend shows denial message; attendance not written.

---

## 8. Admin Panel Design

## 8.1 Pages

1. **Admin Login Page**
   - Email/password form.
   - Stores only cookie-based session.

2. **Dashboard Page**
   - Today’s sessions summary.
   - Quick links: Courses, Sessions, Participants, Attendance, Audit Logs.

3. **Courses Page**
   - Create/edit/deactivate courses.
   - Navigate to session and participant subpages.

4. **Course Sessions Page**
   - List sessions for selected course.
   - Add/update/delete/cancel sessions.

5. **Participants Page**
   - Create/edit participants.
   - Search by normalized email/phone.

6. **Course Assignment Page**
   - Assign/remove participants for selected course.
   - Bulk visual roster management.

7. **Attendance Page**
   - Filter by date/course/session/participant.
   - Manual attendance entry.
   - Remove/correct attendance with reason.

8. **Audit Logs Page**
   - Read-only chronological logs with filters.
   - Shows admin actor + action + old/new values.

## 8.2 Admin Data Flow

1. React calls admin endpoint with cookie session.
2. Express auth middleware validates admin session from `admin_sessions`.
3. Route validator checks payload/query.
4. Service executes SQL transaction.
5. If mutation occurs, service writes `admin_audit_logs` row.
6. API returns updated dataset.

---

## 9. Audit Logging Design

### 9.1 What is logged
Every admin mutation logs one entry, including:
- Admin login/logout (security events)
- Course create/update/delete
- Session create/update/delete/cancel
- Participant create/update
- Course assignment add/remove
- Manual attendance entry
- Attendance removal/correction

### 9.2 Log structure
Each log row stores:
- Actor (`admin_id`)
- Action (`action_type`)
- Target (`entity_type`, `entity_id`)
- Before/after payload (`old_values`, `new_values`)
- Request context (`request_id`, metadata such as IP/user-agent)
- Creation timestamp

### 9.3 When logs are created
- Created in same DB transaction as the change.
- If mutation fails/rolls back, corresponding log is not persisted.
- Read operations are not logged in `admin_audit_logs`.

---

## 10. Validation and Normalization Strategy

## 10.1 Input Validation
- Validate request shape at route boundary.
- Reject unknown/extra fields for write endpoints.
- Validate primitive constraints:
  - `course_id`: non-empty string, max length 64
  - `email`: RFC-like format, max length 255
  - `phone`: acceptable character set then normalize
  - `device_uuid`: valid UUID format
  - numeric route params: positive integers

## 10.2 Normalization Rules
- `email_normalized`:
  - trim whitespace
  - lowercase entire string
- `phone_normalized`:
  - strip spaces, dashes, parentheses
  - standardize leading `+` and country code representation
- Store raw and normalized values in participants table.

## 10.3 Error Response Policy
Common error format:

```json
{
  "success": false,
  "error": {
    "code": "NOT_ASSIGNED_TO_COURSE",
    "message": "Participant is not assigned to this course."
  }
}
```

Standardized codes:
- `VALIDATION_ERROR`
- `COURSE_NOT_FOUND`
- `COURSE_INACTIVE`
- `NO_SESSION_TODAY`
- `PARTICIPANT_NOT_FOUND`
- `PARTICIPANT_IDENTITY_CONFLICT`
- `NOT_ASSIGNED_TO_COURSE`
- `INVALID_DEVICE_UUID`
- `ALREADY_MARKED`
- `UNAUTHORIZED_ADMIN`
- `FORBIDDEN_ADMIN`
- `INTERNAL_ERROR`

---

## 11. Security Model for QR and Attendance

### 11.1 Core (Implemented)
- QR carries only `course_id`.
- Backend is sole authority for validation.
- No attendance write is allowed unless a valid session exists today.
- Session-based uniqueness blocks duplicate attendance.
- Device UUID is validated server-side and can be revoked.

### 11.2 Future Extension (Not Core Flow)
- Add short-lived signed token in QR URL (e.g., minute-level expiry) to reduce link sharing abuse.
- This extension is explicitly outside current core implementation and does not change baseline flow.

---

## 12. Deployment and Environment

### 12.1 Frontend (Vercel)
- Deploy React SPA.
- Environment variable:
  - `VITE_API_BASE_URL`

### 12.2 Backend (Nexus)
- Deploy Express API.
- Environment variables:
  - `PORT`
  - `NODE_ENV`
  - `DATABASE_URL`
  - `CORS_ALLOWED_ORIGIN`
  - `ADMIN_SESSION_TTL_HOURS`
  - `SESSION_COOKIE_NAME`
  - `SESSION_COOKIE_SECURE`
  - `BCRYPT_ROUNDS`

### 12.3 Database (PostgreSQL)
- Backend-only access.
- TLS enabled.
- Regular backups and restore drills.

---

## 13. Interview-Ready Rationale

1. **Session-based correctness:** Attendance is tied to actual meeting sessions, not generic course/date assumptions.
2. **DB-first integrity:** Uniqueness and FKs enforce correctness under concurrency.
3. **Deterministic identity matching:** Phone-first, then email, with explicit conflict rejection.
4. **Device practicality without trust leakage:** UUID speeds repeat usage while backend remains source of truth.
5. **Operational governance:** Full admin panel plus immutable audit logs supports real institutional workflows.

This design is final, consistent, and directly implementable with React + Express + PostgreSQL + `pg` on Vercel/Nexus.
