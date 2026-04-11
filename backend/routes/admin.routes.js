const crypto = require('node:crypto');
const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db');

const router = express.Router();

const SESSION_TTL_MINUTES = Number(process.env.ADMIN_SESSION_TTL_MINUTES || 30);
const RATE_LIMIT_WINDOW_MS = Number(process.env.ADMIN_LOGIN_RATE_WINDOW_MS || 15 * 60 * 1000);
const RATE_LIMIT_MAX_ATTEMPTS = Number(process.env.ADMIN_LOGIN_RATE_MAX_ATTEMPTS || 5);
const ADMIN_COOKIE_NAME = process.env.ADMIN_COOKIE_NAME || 'admin_session';

const loginBuckets = new Map();

function createError(code, message, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return header
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce((acc, pair) => {
      const sep = pair.indexOf('=');
      if (sep === -1) return acc;
      const key = pair.slice(0, sep).trim();
      const value = decodeURIComponent(pair.slice(sep + 1));
      acc[key] = value;
      return acc;
    }, {});
}

function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production';
  const maxAge = SESSION_TTL_MINUTES * 60;
  const parts = [
    `${ADMIN_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAge}`
  ];

  if (secure) {
    parts.push('Secure');
  }

  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production';
  const parts = [
    `${ADMIN_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=0'
  ];

  if (secure) {
    parts.push('Secure');
  }

  res.setHeader('Set-Cookie', parts.join('; '));
}

function now() {
  return Date.now();
}

function checkRateLimit(email, ip) {
  const key = `${ip}:${String(email || '').toLowerCase().trim()}`;
  const bucket = loginBuckets.get(key) || [];
  const threshold = now() - RATE_LIMIT_WINDOW_MS;
  const filtered = bucket.filter((time) => time >= threshold);

  if (filtered.length >= RATE_LIMIT_MAX_ATTEMPTS) {
    throw createError('TOO_MANY_ATTEMPTS', 'Too many attempts. Please try later.', 429);
  }

  loginBuckets.set(key, filtered);
  return key;
}

function trackRateLimitFailure(key) {
  const bucket = loginBuckets.get(key) || [];
  bucket.push(now());
  loginBuckets.set(key, bucket);
}

function clearRateLimitKey(key) {
  loginBuckets.delete(key);
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

async function logAdminAction({ adminId, actionType, entityType, entityId = null, oldValues = null, newValues = null }) {
  await db.query(
    `INSERT INTO admin_audit_logs (admin_id, action_type, entity_type, entity_id, old_values, new_values)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
    [adminId, actionType, entityType, entityId, oldValues ? JSON.stringify(oldValues) : null, newValues ? JSON.stringify(newValues) : null]
  );
}

async function getAdminBySession(req) {
  const cookies = parseCookies(req);
  const token = cookies[ADMIN_COOKIE_NAME];
  if (!token) {
    throw createError('UNAUTHORIZED', 'Unauthorized', 401);
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const result = await db.query(
    `SELECT s.id AS session_id, s.admin_id, s.expires_at, s.revoked_at, a.email, a.full_name
     FROM admin_sessions s
     JOIN admins a ON a.id = s.admin_id
     WHERE s.session_token_hash = $1
       AND s.revoked_at IS NULL
       AND s.expires_at > NOW()
       AND a.is_active = TRUE
     LIMIT 1`,
    [tokenHash]
  );

  const row = result.rows[0];
  if (!row) {
    throw createError('UNAUTHORIZED', 'Unauthorized', 401);
  }

  return row;
}

async function requireAdmin(req, res, next) {
  try {
    const admin = await getAdminBySession(req);
    req.admin = admin;
    next();
  } catch (error) {
    next(error);
  }
}

function parseWorkbookRows(fileBase64, fileName = 'upload.csv') {
  let csvText;
  try {
    csvText = Buffer.from(fileBase64, 'base64').toString('utf8');
  } catch {
    throw createError('INVALID_FILE', 'Invalid file encoding.', 400);
  }

  const lines = csvText.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) {
    throw createError('INVALID_FILE', `Cannot parse file ${fileName}.`, 400);
  }

  const headers = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cols = line.split(',');
    const row = {};
    headers.forEach((header, index) => {
      row[header] = (cols[index] || '').trim();
    });
    return row;
  });
}

router.post('/auth/login', async (req, res, next) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');

  let key;

  try {
    if (!email || !password) {
      throw createError('INVALID_CREDENTIALS', 'Invalid email or password.', 401);
    }

    key = checkRateLimit(email, ip);

    const result = await db.query(
      `SELECT id, email, password_hash, full_name, is_active
       FROM admins
       WHERE email = $1
       LIMIT 1`,
      [email]
    );

    const admin = result.rows[0];
    const hashToCompare = admin?.password_hash || '$2b$10$QQQQQQQQQQQQQQQQQQQQQON7atc7OA5vPTsCkXbkqVKgf/mBlC9he';
    const passwordOk = await bcrypt.compare(password, hashToCompare);

    if (!admin || !admin.is_active || !passwordOk) {
      trackRateLimitFailure(key);
      if (admin?.id) {
        await logAdminAction({
          adminId: admin.id,
          actionType: 'ADMIN_LOGIN_FAILED',
          entityType: 'admin',
          entityId: admin.id,
          oldValues: null,
          newValues: { ip }
        });
      }

      throw createError('INVALID_CREDENTIALS', 'Invalid email or password.', 401);
    }

    const token = crypto.randomBytes(48).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const sessionInsert = await db.query(
      `INSERT INTO admin_sessions (admin_id, session_token_hash, expires_at)
       VALUES ($1, $2, NOW() + ($3 || ' minutes')::interval)
       RETURNING id, expires_at`,
      [admin.id, tokenHash, String(SESSION_TTL_MINUTES)]
    );

    setSessionCookie(res, token);
    clearRateLimitKey(key);

    await logAdminAction({
      adminId: admin.id,
      actionType: 'ADMIN_LOGIN_SUCCESS',
      entityType: 'admin_session',
      entityId: sessionInsert.rows[0].id,
      newValues: { ip, expires_at: sessionInsert.rows[0].expires_at }
    });

    res.json({
      success: true,
      data: {
        admin: {
          id: admin.id,
          email: admin.email,
          full_name: admin.full_name
        },
        expires_at: sessionInsert.rows[0].expires_at
      }
    });
  } catch (error) {
    next(error);
  }
});

router.post('/auth/logout', requireAdmin, async (req, res, next) => {
  try {
    const cookies = parseCookies(req);
    const tokenHash = crypto.createHash('sha256').update(cookies[ADMIN_COOKIE_NAME] || '').digest('hex');

    await db.query(
      `UPDATE admin_sessions
       SET revoked_at = NOW()
       WHERE session_token_hash = $1
         AND revoked_at IS NULL`,
      [tokenHash]
    );

    await logAdminAction({
      adminId: req.admin.admin_id,
      actionType: 'ADMIN_LOGOUT',
      entityType: 'admin_session',
      entityId: req.admin.session_id
    });

    clearSessionCookie(res);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.get('/auth/me', requireAdmin, async (req, res) => {
  res.json({
    success: true,
    data: {
      admin: {
        id: req.admin.admin_id,
        email: req.admin.email,
        full_name: req.admin.full_name
      }
    }
  });
});

router.get('/dashboard', requireAdmin, async (req, res, next) => {
  try {
    const [courses, attendance, participants, recentLogs] = await Promise.all([
      db.query(
        `SELECT COUNT(*)::int AS active_courses_today
         FROM course_sessions cs
         WHERE cs.session_date = CURRENT_DATE
           AND cs.is_cancelled = FALSE`
      ),
      db.query(
        `SELECT COUNT(*)::int AS attendance_today
         FROM attendance_records ar
         JOIN course_sessions cs ON cs.id = ar.session_id
         WHERE cs.session_date = CURRENT_DATE
           AND ar.removed_at IS NULL`
      ),
      db.query('SELECT COUNT(*)::int AS participant_count FROM participants'),
      db.query(
        `SELECT l.id, l.action_type, l.entity_type, l.entity_id, l.created_at, a.full_name AS admin_name
         FROM admin_audit_logs l
         JOIN admins a ON a.id = l.admin_id
         ORDER BY l.created_at DESC
         LIMIT 15`
      )
    ]);

    res.json({
      success: true,
      data: {
        active_courses_today: courses.rows[0].active_courses_today,
        attendance_today: attendance.rows[0].attendance_today,
        participant_count: participants.rows[0].participant_count,
        recent_activity: recentLogs.rows
      }
    });
  } catch (error) {
    next(error);
  }
});

router.get('/courses', requireAdmin, async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT c.*, COUNT(cs.id)::int AS session_count
       FROM courses c
       LEFT JOIN course_sessions cs ON cs.course_id = c.id
       GROUP BY c.id
       ORDER BY c.year DESC, c.month DESC, c.id DESC`
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
});

router.post('/courses', requireAdmin, async (req, res, next) => {
  try {
    const { sap_course_id, course_title, month, year } = req.body || {};

    if (!sap_course_id || !month || !year) {
      throw createError('VALIDATION_ERROR', 'Missing course fields.', 400);
    }

    const result = await db.query(
      `INSERT INTO courses (sap_course_id, course_title, month, year)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [String(sap_course_id).trim(), String(course_title || '').trim(), Number(month), Number(year)]
    );

    await logAdminAction({
      adminId: req.admin.admin_id,
      actionType: 'COURSE_CREATED',
      entityType: 'course',
      entityId: result.rows[0].id,
      newValues: result.rows[0]
    });

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

router.put('/courses/:courseId', requireAdmin, async (req, res, next) => {
  try {
    const courseId = Number(req.params.courseId);
    const existing = await db.query('SELECT * FROM courses WHERE id = $1 LIMIT 1', [courseId]);
    const prev = existing.rows[0];
    if (!prev) {
      throw createError('NOT_FOUND', 'Course not found.', 404);
    }

    const payload = {
      sap_course_id: String(req.body?.sap_course_id || prev.sap_course_id).trim(),
      course_title: String(req.body?.course_title || prev.course_title || '').trim(),
      month: Number(req.body?.month || prev.month),
      year: Number(req.body?.year || prev.year)
    };

    const result = await db.query(
      `UPDATE courses
       SET sap_course_id = $1, course_title = $2, month = $3, year = $4, updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [payload.sap_course_id, payload.course_title, payload.month, payload.year, courseId]
    );

    await logAdminAction({
      adminId: req.admin.admin_id,
      actionType: 'COURSE_UPDATED',
      entityType: 'course',
      entityId: courseId,
      oldValues: prev,
      newValues: result.rows[0]
    });

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

router.post('/courses/:courseId/sessions', requireAdmin, async (req, res, next) => {
  try {
    const courseId = Number(req.params.courseId);
    const { session_date, start_time, end_time } = req.body || {};
    if (!session_date) {
      throw createError('VALIDATION_ERROR', 'session_date is required.', 400);
    }

    const result = await db.query(
      `INSERT INTO course_sessions (course_id, session_date, start_time, end_time)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [courseId, session_date, start_time || null, end_time || null]
    );

    await logAdminAction({
      adminId: req.admin.admin_id,
      actionType: 'SESSION_CREATED',
      entityType: 'course_session',
      entityId: result.rows[0].id,
      newValues: result.rows[0]
    });

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    if (error?.code === '23505') {
      next(createError('SESSION_CONFLICT', 'Session already exists for this date.', 409));
      return;
    }

    next(error);
  }
});

router.put('/sessions/:sessionId', requireAdmin, async (req, res, next) => {
  try {
    const sessionId = Number(req.params.sessionId);
    const existing = await db.query('SELECT * FROM course_sessions WHERE id = $1 LIMIT 1', [sessionId]);
    const prev = existing.rows[0];
    if (!prev) {
      throw createError('NOT_FOUND', 'Session not found.', 404);
    }

    const nextData = {
      session_date: req.body?.session_date || prev.session_date,
      start_time: req.body?.start_time || prev.start_time,
      end_time: req.body?.end_time || prev.end_time,
      is_cancelled:
        typeof req.body?.is_cancelled === 'boolean' ? req.body.is_cancelled : prev.is_cancelled
    };

    const result = await db.query(
      `UPDATE course_sessions
       SET session_date = $1, start_time = $2, end_time = $3, is_cancelled = $4, updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [nextData.session_date, nextData.start_time, nextData.end_time, nextData.is_cancelled, sessionId]
    );

    await logAdminAction({
      adminId: req.admin.admin_id,
      actionType: nextData.is_cancelled && !prev.is_cancelled ? 'SESSION_CANCELLED' : 'SESSION_UPDATED',
      entityType: 'course_session',
      entityId: sessionId,
      oldValues: prev,
      newValues: result.rows[0]
    });

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    if (error?.code === '23505') {
      next(createError('SESSION_CONFLICT', 'Session already exists for this date.', 409));
      return;
    }

    next(error);
  }
});

router.get('/enrollments/:courseId', requireAdmin, async (req, res, next) => {
  try {
    const courseId = Number(req.params.courseId);
    const result = await db.query(
      `SELECT *
       FROM course_enrollments
       WHERE course_id = $1
       ORDER BY id DESC`,
      [courseId]
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
});

router.post('/enrollments/:courseId', requireAdmin, async (req, res, next) => {
  try {
    const courseId = Number(req.params.courseId);
    const payload = {
      first_name: String(req.body?.first_name || '').trim() || null,
      last_name: String(req.body?.last_name || '').trim() || null,
      phone: normalizePhone(req.body?.phone),
      email: normalizeEmail(req.body?.email)
    };

    if (!payload.phone || !payload.email) {
      throw createError('VALIDATION_ERROR', 'Phone and email are required.', 400);
    }

    const result = await db.query(
      `INSERT INTO course_enrollments (course_id, first_name, last_name, phone, email)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [courseId, payload.first_name, payload.last_name, payload.phone, payload.email]
    );

    await logAdminAction({
      adminId: req.admin.admin_id,
      actionType: 'ENROLLMENT_ADDED',
      entityType: 'course_enrollment',
      entityId: result.rows[0].id,
      newValues: result.rows[0]
    });

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

router.delete('/enrollments/item/:enrollmentId', requireAdmin, async (req, res, next) => {
  try {
    const enrollmentId = Number(req.params.enrollmentId);
    const existing = await db.query('SELECT * FROM course_enrollments WHERE id = $1 LIMIT 1', [enrollmentId]);
    const prev = existing.rows[0];
    if (!prev) {
      throw createError('NOT_FOUND', 'Enrollment not found.', 404);
    }

    await db.query('DELETE FROM course_enrollments WHERE id = $1', [enrollmentId]);

    await logAdminAction({
      adminId: req.admin.admin_id,
      actionType: 'ENROLLMENT_REMOVED',
      entityType: 'course_enrollment',
      entityId: enrollmentId,
      oldValues: prev
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.post('/enrollments/import', requireAdmin, async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    const courseId = Number(req.body?.course_id);
    const fileBase64 = String(req.body?.file_base64 || '');
    const fileName = String(req.body?.file_name || 'upload.xlsx');

    if (!courseId || !fileBase64) {
      throw createError('VALIDATION_ERROR', 'course_id and file_base64 are required.', 400);
    }

    const rows = parseWorkbookRows(fileBase64, fileName);
    if (!rows.length) {
      throw createError('VALIDATION_ERROR', 'No enrollment rows found.', 400);
    }

    const normalizedRows = rows.map((row, index) => {
      const firstName = String(row.first_name || row.firstName || row['First Name'] || '').trim() || null;
      const lastName = String(row.last_name || row.lastName || row['Last Name'] || '').trim() || null;
      const phone = normalizePhone(row.phone || row.Phone || row.mobile || '');
      const email = normalizeEmail(row.email || row.Email || '');

      if (!phone || !email) {
        throw createError('VALIDATION_ERROR', `Row ${index + 2} missing required phone/email`, 400);
      }

      return {
        first_name: firstName,
        last_name: lastName,
        phone,
        email
      };
    });

    await client.query('BEGIN');

    const oldResult = await client.query('SELECT * FROM course_enrollments WHERE course_id = $1 ORDER BY id', [courseId]);
    await client.query('DELETE FROM course_enrollments WHERE course_id = $1', [courseId]);

    for (const row of normalizedRows) {
      await client.query(
        `INSERT INTO course_enrollments (course_id, first_name, last_name, phone, email)
         VALUES ($1, $2, $3, $4, $5)`,
        [courseId, row.first_name, row.last_name, row.phone, row.email]
      );
    }

    await client.query('COMMIT');

    await logAdminAction({
      adminId: req.admin.admin_id,
      actionType: 'ENROLLMENT_IMPORT_REPLACED',
      entityType: 'course_enrollment',
      entityId: courseId,
      oldValues: { rows: oldResult.rows },
      newValues: { row_count: normalizedRows.length, file_name: fileName }
    });

    res.json({ success: true, data: { replaced: normalizedRows.length } });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {}
    next(error);
  } finally {
    client.release();
  }
});

router.get('/attendance/:courseId', requireAdmin, async (req, res, next) => {
  try {
    const courseId = Number(req.params.courseId);
    const sessionsResult = await db.query(
      `SELECT * FROM course_sessions WHERE course_id = $1 ORDER BY session_date ASC`,
      [courseId]
    );

    const participantsResult = await db.query(
      `SELECT DISTINCT p.id, p.first_name, p.last_name, p.phone, p.email
       FROM participants p
       JOIN course_participants cp ON cp.participant_id = p.id
       WHERE cp.course_id = $1
       ORDER BY p.first_name, p.last_name`,
      [courseId]
    );

    const attendanceResult = await db.query(
      `SELECT ar.*, cs.course_id
       FROM attendance_records ar
       JOIN course_sessions cs ON cs.id = ar.session_id
       WHERE cs.course_id = $1`,
      [courseId]
    );

    res.json({
      success: true,
      data: {
        sessions: sessionsResult.rows,
        participants: participantsResult.rows,
        records: attendanceResult.rows
      }
    });
  } catch (error) {
    next(error);
  }
});

router.post('/attendance/override', requireAdmin, async (req, res, next) => {
  try {
    const { session_id, participant_id, present, notes } = req.body || {};
    if (!session_id || !participant_id || typeof present !== 'boolean') {
      throw createError('VALIDATION_ERROR', 'session_id, participant_id, present required.', 400);
    }

    const existing = await db.query(
      `SELECT * FROM attendance_records WHERE session_id = $1 AND participant_id = $2 LIMIT 1`,
      [session_id, participant_id]
    );

    const prev = existing.rows[0] || null;
    let nextRow = null;

    if (present) {
      if (!prev) {
        const inserted = await db.query(
          `INSERT INTO attendance_records (session_id, participant_id, source, notes, removed_at)
           VALUES ($1, $2, 'admin_manual', $3, NULL)
           RETURNING *`,
          [session_id, participant_id, notes || null]
        );
        nextRow = inserted.rows[0];
      } else {
        const updated = await db.query(
          `UPDATE attendance_records
           SET source = 'admin_manual', notes = $1, removed_at = NULL, marked_at = NOW()
           WHERE id = $2
           RETURNING *`,
          [notes || null, prev.id]
        );
        nextRow = updated.rows[0];
      }
    } else if (prev) {
      const updated = await db.query(
        `UPDATE attendance_records
         SET source = 'admin_manual', notes = $1, removed_at = NOW()
         WHERE id = $2
         RETURNING *`,
        [notes || null, prev.id]
      );
      nextRow = updated.rows[0];
    }

    await logAdminAction({
      adminId: req.admin.admin_id,
      actionType: 'ATTENDANCE_OVERRIDE',
      entityType: 'attendance_record',
      entityId: nextRow?.id || prev?.id || null,
      oldValues: prev,
      newValues: nextRow || { session_id, participant_id, present: false }
    });

    res.json({ success: true, data: nextRow });
  } catch (error) {
    next(error);
  }
});

router.get('/participants', requireAdmin, async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.page_size || 20)));
    const offset = (page - 1) * pageSize;

    const result = await db.query(
      `SELECT p.*
       FROM participants p
       WHERE $1 = ''
          OR lower(p.first_name || ' ' || p.last_name) LIKE lower('%' || $1 || '%')
          OR p.phone LIKE '%' || $1 || '%'
          OR lower(COALESCE(p.email, '')) LIKE lower('%' || $1 || '%')
       ORDER BY p.id DESC
       LIMIT $2 OFFSET $3`,
      [q, pageSize, offset]
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
});

router.get('/participants/:participantId', requireAdmin, async (req, res, next) => {
  try {
    const participantId = Number(req.params.participantId);
    const participantResult = await db.query('SELECT * FROM participants WHERE id = $1 LIMIT 1', [participantId]);
    const participant = participantResult.rows[0];
    if (!participant) {
      throw createError('NOT_FOUND', 'Participant not found.', 404);
    }

    const [courses, attendance] = await Promise.all([
      db.query(
        `SELECT c.*
         FROM courses c
         JOIN course_participants cp ON cp.course_id = c.id
         WHERE cp.participant_id = $1`,
        [participantId]
      ),
      db.query(
        `SELECT ar.*, cs.session_date, cs.course_id
         FROM attendance_records ar
         JOIN course_sessions cs ON cs.id = ar.session_id
         WHERE ar.participant_id = $1
         ORDER BY cs.session_date DESC`,
        [participantId]
      )
    ]);

    res.json({ success: true, data: { participant, courses: courses.rows, attendance: attendance.rows } });
  } catch (error) {
    next(error);
  }
});

router.get('/logs', requireAdmin, async (req, res, next) => {
  try {
    const adminId = Number(req.query.admin_id || 0);
    const entityType = String(req.query.entity_type || '').trim();
    const actionType = String(req.query.action_type || '').trim();
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.page_size || 20)));
    const offset = (page - 1) * pageSize;

    const result = await db.query(
      `SELECT l.*, a.full_name AS admin_name, a.email AS admin_email
       FROM admin_audit_logs l
       JOIN admins a ON a.id = l.admin_id
       WHERE ($1 = 0 OR l.admin_id = $1)
         AND ($2 = '' OR l.entity_type = $2)
         AND ($3 = '' OR l.action_type = $3)
       ORDER BY l.created_at DESC
       LIMIT $4 OFFSET $5`,
      [adminId, entityType, actionType, pageSize, offset]
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
});

router.get('/attendance-export/:courseId', requireAdmin, async (req, res, next) => {
  try {
    const courseId = Number(req.params.courseId);

    const sessionsResult = await db.query(
      `SELECT id, session_date
       FROM course_sessions
       WHERE course_id = $1
       ORDER BY session_date ASC`,
      [courseId]
    );

    const participantResult = await db.query(
      `SELECT p.id, p.first_name, p.last_name, p.phone, p.email
       FROM participants p
       JOIN course_participants cp ON cp.participant_id = p.id
       WHERE cp.course_id = $1
       ORDER BY p.first_name, p.last_name`,
      [courseId]
    );

    const attendanceResult = await db.query(
      `SELECT ar.session_id, ar.participant_id, ar.removed_at
       FROM attendance_records ar
       JOIN course_sessions cs ON cs.id = ar.session_id
       WHERE cs.course_id = $1`,
      [courseId]
    );

    const attendanceMap = new Map();
    for (const record of attendanceResult.rows) {
      attendanceMap.set(`${record.participant_id}:${record.session_id}`, record.removed_at ? '' : 'P');
    }

    const rows = participantResult.rows.map((participant) => {
      const row = {
        Name: `${participant.first_name} ${participant.last_name}`.trim(),
        Phone: participant.phone,
        Email: participant.email || ''
      };

      for (const session of sessionsResult.rows) {
        const key = `Session ${session.session_date}`;
        row[key] = attendanceMap.get(`${participant.id}:${session.id}`) || '';
      }

      return row;
    });

    res.json({ success: true, data: rows });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
