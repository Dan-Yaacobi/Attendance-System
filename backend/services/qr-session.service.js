const crypto = require('node:crypto');
const db = require('../db');

const QR_SESSION_TTL_HOURS = Number(process.env.QR_SESSION_TTL_HOURS || 2);
const SIGNIN_TOKEN_TTL_SECONDS = Number(process.env.SIGNIN_TOKEN_TTL_SECONDS || 45);

function createServiceError(code, message, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function createSessionId() {
  return crypto.randomBytes(24).toString('hex');
}

function createSignInToken() {
  return crypto.randomBytes(18).toString('base64url');
}

function getFrontendBaseUrl() {
  return process.env.FRONTEND_BASE_URL || process.env.CORS_ALLOWED_ORIGIN || '';
}

async function createQrSession({ courseId, adminId }) {
  const sessionId = createSessionId();
  const result = await db.query(
    `INSERT INTO qr_sessions (session_id, course_id, created_by_admin_id, expires_at)
     VALUES ($1, $2, $3, NOW() + ($4::text || ' hour')::interval)
     RETURNING session_id, course_id, expires_at, created_at`,
    [sessionId, courseId, adminId || null, QR_SESSION_TTL_HOURS]
  );

  const frontendBase = getFrontendBaseUrl();
  const qrLink = frontendBase
    ? `${frontendBase.replace(/\/$/, '')}/qr-display/${sessionId}`
    : `/qr-display/${sessionId}`;

  return {
    ...result.rows[0],
    qr_link: qrLink
  };
}

async function getValidQrSession(sessionId) {
  const result = await db.query(
    `SELECT qs.session_id, qs.course_id, qs.expires_at, c.sap_course_id
     FROM qr_sessions qs
     JOIN courses c ON c.id = qs.course_id
     WHERE qs.session_id = $1
     LIMIT 1`,
    [sessionId]
  );

  const session = result.rows[0];
  if (!session) {
    throw createServiceError('INVALID_QR_SESSION', 'QR session is invalid.', 404);
  }

  if (new Date(session.expires_at).getTime() <= Date.now()) {
    throw createServiceError('QR_SESSION_EXPIRED', 'QR session has expired.', 410);
  }

  return session;
}

async function getOrCreateCourseToken(courseId) {
  const existingResult = await db.query(
    `SELECT token, expires_at
     FROM course_signin_tokens
     WHERE course_id = $1`,
    [courseId]
  );

  const existing = existingResult.rows[0];

  if (existing && new Date(existing.expires_at).getTime() > Date.now()) {
    return existing;
  }

  const token = createSignInToken();

  const upsertResult = await db.query(
    `INSERT INTO course_signin_tokens (course_id, token, expires_at)
     VALUES ($1, $2, NOW() + ($3::text || ' second')::interval)
     ON CONFLICT (course_id)
     DO UPDATE SET
       token = EXCLUDED.token,
       expires_at = EXCLUDED.expires_at,
       updated_at = NOW()
     RETURNING token, expires_at`,
    [courseId, token, SIGNIN_TOKEN_TTL_SECONDS]
  );

  return upsertResult.rows[0];
}

async function getQrDisplayPayload(sessionId) {
  const session = await getValidQrSession(sessionId);
  const tokenRow = await getOrCreateCourseToken(session.course_id);

  return {
    session_id: session.session_id,
    course_id: session.sap_course_id,
    token: tokenRow.token,
    token_expires_at: tokenRow.expires_at,
    session_expires_at: session.expires_at
  };
}

async function validateSignInToken({ sapCourseId, token }) {
  const result = await db.query(
    `SELECT c.id AS course_pk, t.token, t.expires_at
     FROM courses c
     LEFT JOIN course_signin_tokens t ON t.course_id = c.id
     WHERE c.sap_course_id = $1
     LIMIT 1`,
    [sapCourseId]
  );

  const row = result.rows[0];

  if (!row) {
    throw createServiceError('COURSE_NOT_FOUND', 'Course was not found.', 404);
  }

  if (!row.token) {
    throw createServiceError('TOKEN_INVALID', 'Sign-in token is invalid.', 401);
  }

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    throw createServiceError('TOKEN_EXPIRED', 'Sign-in token has expired.', 401);
  }

  if (row.token !== token) {
    throw createServiceError('TOKEN_INVALID', 'Sign-in token is invalid.', 401);
  }

  return { coursePk: row.course_pk };
}

module.exports = {
  createQrSession,
  getQrDisplayPayload,
  validateSignInToken
};
