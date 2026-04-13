const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const express = require('express');
const db = require('../db');
const { SESSION_COOKIE_NAME, hashToken, requireAdminAuth } = require('../middleware/auth.middleware');
const {
  parsePagination,
  validateAdminLoginPayload,
  validateCoursePayload,
  validateSessionPayload,
  validateEnrollmentPayload,
  validateEnrollmentReplacePayload,
  validateAttendanceUpdatePayload
} = require('../validators/admin.validator');
const { getAuditLogs, logAdminAction } = require('../services/audit.service');
const { createQrSession } = require('../services/qr-session.service');

const router = express.Router();

const loginAttempts = new Map();
const SESSION_TTL_HOURS = 8;

function createError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function setAdminCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production';
  const cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${60 * 60 * SESSION_TTL_HOURS}; SameSite=Strict${secure ? '; Secure' : ''}`;
  res.setHeader('Set-Cookie', cookie);
}

function clearAdminCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict`);
}

function checkLoginRateLimit(email, ip) {
  const key = `${email}:${ip}`;
  const entry = loginAttempts.get(key) || { count: 0, resetAt: Date.now() + 10 * 60 * 1000 };

  if (Date.now() > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = Date.now() + 10 * 60 * 1000;
  }

  entry.count += 1;
  loginAttempts.set(key, entry);
  if (entry.count > 5) {
    throw createError('RATE_LIMITED', 'Too many login attempts', 429);
  }
}

router.post('/auth/login', async (req, res, next) => {
  try {
    const payload = validateAdminLoginPayload(req.body);
    checkLoginRateLimit(payload.email, req.ip);

    const adminResult = await db.query(
      'SELECT id, email, full_name, password_hash, is_active FROM admins WHERE email = $1 LIMIT 1',
      [payload.email]
    );

    const admin = adminResult.rows[0];
    const passwordHash = admin.password_hash;
    const passwordOk = await bcrypt.compare(payload.password, passwordHash);

    if (!admin || !admin.is_active || !passwordOk) {
      await logAdminAction({ actionType: 'login_failed', entityType: 'auth', newValues: { email: payload.email, ip: req.ip } });
      throw createError('INVALID_CREDENTIALS', 'Invalid credentials', 401);
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawToken);

    const sessionResult = await db.query(
      `INSERT INTO admin_sessions (admin_id, session_token_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '${SESSION_TTL_HOURS} hour')
       RETURNING id, expires_at`,
      [admin.id, tokenHash]
    );

    setAdminCookie(res, rawToken);
    await logAdminAction({ adminId: admin.id, actionType: 'login_success', entityType: 'auth', entityId: sessionResult.rows[0].id });

    res.json({ success: true, data: { admin: { id: admin.id, email: admin.email, full_name: admin.full_name }, expires_at: sessionResult.rows[0].expires_at } });
  } catch (error) {
    next(error);
  }
});

router.post('/auth/logout', requireAdminAuth, async (req, res, next) => {
  try {
    await db.query('UPDATE admin_sessions SET revoked_at = NOW() WHERE id = $1', [req.admin.session_id]);
    clearAdminCookie(res);
    await logAdminAction({ adminId: req.admin.id, actionType: 'logout', entityType: 'auth', entityId: req.admin.session_id });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.get('/auth/me', requireAdminAuth, async (req, res) => {
  res.json({ success: true, data: { admin: req.admin } });
});

router.get('/dashboard', requireAdminAuth, async (req, res, next) => {
  try {
    const [activeCourses, attendanceToday, participantCount, recentLogs] = await Promise.all([
      db.query(`SELECT COUNT(DISTINCT course_id)::int AS count FROM course_sessions WHERE session_date = CURRENT_DATE AND is_cancelled = FALSE`),
      db.query(`SELECT COUNT(*)::int AS count FROM attendance_records ar JOIN course_sessions cs ON cs.id = ar.session_id WHERE cs.session_date = CURRENT_DATE AND ar.removed_at IS NULL`),
      db.query('SELECT COUNT(*)::int AS count FROM participants'),
      db.query(`SELECT action_type, entity_type, created_at FROM admin_audit_logs ORDER BY created_at DESC LIMIT 10`)
    ]);

    res.json({
      success: true,
      data: {
        active_courses_today: activeCourses.rows[0].count,
        attendance_today: attendanceToday.rows[0].count,
        participant_count: participantCount.rows[0].count,
        recent_activity: recentLogs.rows
      }
    });
  } catch (error) {
    next(error);
  }
});

router.get('/courses', requireAdminAuth, async (req, res, next) => {
  try {
    const result = await db.query(`SELECT c.*, COUNT(cs.id)::int AS session_count FROM courses c LEFT JOIN course_sessions cs ON cs.course_id = c.id GROUP BY c.id ORDER BY c.created_at DESC`);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
});

router.post('/courses', requireAdminAuth, async (req, res, next) => {
  try {
    const payload = validateCoursePayload(req.body);
    const result = await db.query(
      `INSERT INTO courses (sap_course_id, course_title, month, year)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [payload.sap_course_id, payload.course_title, payload.month, payload.year]
    );
    await logAdminAction({ adminId: req.admin.id, actionType: 'course_create', entityType: 'course', entityId: result.rows[0].id, newValues: result.rows[0] });
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});


router.post('/courses/:courseId/qr-session', requireAdminAuth, async (req, res, next) => {
  try {
    const courseId = Number(req.params.courseId);
    const courseResult = await db.query('SELECT id FROM courses WHERE id = $1', [courseId]);

    if (!courseResult.rows[0]) {
      throw createError('COURSE_NOT_FOUND', 'Course was not found.', 404);
    }

    const qrSession = await createQrSession({ courseId, adminId: req.admin.id });
    await logAdminAction({
      adminId: req.admin.id,
      actionType: 'qr_session_create',
      entityType: 'course',
      entityId: courseId,
      newValues: { session_id: qrSession.session_id, expires_at: qrSession.expires_at }
    });

    res.status(201).json({ success: true, data: qrSession });
  } catch (error) {
    next(error);
  }
});

router.put('/courses/:courseId', requireAdminAuth, async (req, res, next) => {
  try {
    const courseId = Number(req.params.courseId);
    const payload = validateCoursePayload(req.body);
    const before = await db.query('SELECT * FROM courses WHERE id = $1', [courseId]);
    const result = await db.query(
      `UPDATE courses
       SET sap_course_id = $1, course_title = $2, month = $3, year = $4, updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [payload.sap_course_id, payload.course_title, payload.month, payload.year, courseId]
    );
    await logAdminAction({ adminId: req.admin.id, actionType: 'course_update', entityType: 'course', entityId: courseId, oldValues: before.rows[0], newValues: result.rows[0] });
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});


router.get('/courses/:courseId/sessions', requireAdminAuth, async (req, res, next) => {
  try {
    const courseId = Number(req.params.courseId);
    const result = await db.query(
      `SELECT id, course_id, session_date::text AS session_date, start_time, end_time, is_cancelled, created_at, updated_at
       FROM course_sessions
       WHERE course_id = $1
       ORDER BY session_date ASC`,
      [courseId]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
});

router.post('/courses/:courseId/sessions', requireAdminAuth, async (req, res, next) => {
  try {
    const courseId = Number(req.params.courseId);
    const payload = validateSessionPayload(req.body);
    const result = await db.query(
      `INSERT INTO course_sessions (course_id, session_date, start_time, end_time)
       VALUES ($1, $2, $3, $4)
       RETURNING id, course_id, session_date::text AS session_date, start_time, end_time, is_cancelled, created_at, updated_at`,
      [courseId, payload.session_date, payload.start_time, payload.end_time]
    );
    await logAdminAction({ adminId: req.admin.id, actionType: 'session_create', entityType: 'session', entityId: result.rows[0].id, newValues: result.rows[0] });
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

router.put('/sessions/:sessionId', requireAdminAuth, async (req, res, next) => {
  try {
    const sessionId = Number(req.params.sessionId);
    const payload = validateSessionPayload(req.body);
    const before = await db.query('SELECT * FROM course_sessions WHERE id = $1', [sessionId]);
    const result = await db.query(
      `UPDATE course_sessions
       SET session_date = $1, start_time = $2, end_time = $3, updated_at = NOW()
       WHERE id = $4
       RETURNING id, course_id, session_date::text AS session_date, start_time, end_time, is_cancelled, created_at, updated_at`,
      [payload.session_date, payload.start_time, payload.end_time, sessionId]
    );
    await logAdminAction({ adminId: req.admin.id, actionType: 'session_update', entityType: 'session', entityId: sessionId, oldValues: before.rows[0], newValues: result.rows[0] });
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});


router.delete('/sessions/:sessionId', requireAdminAuth, async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    const sessionId = Number(req.params.sessionId);
    const before = await client.query('SELECT * FROM course_sessions WHERE id = $1', [sessionId]);

    await client.query('BEGIN');
    await client.query('DELETE FROM attendance_records WHERE session_id = $1', [sessionId]);
    await client.query('DELETE FROM course_sessions WHERE id = $1', [sessionId]);
    await client.query('COMMIT');

    await logAdminAction({ adminId: req.admin.id, actionType: 'session_delete', entityType: 'session', entityId: sessionId, oldValues: before.rows[0] || null });
    res.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
});

router.post('/sessions/:sessionId/cancel', requireAdminAuth, async (req, res, next) => {
  try {
    const sessionId = Number(req.params.sessionId);
    const before = await db.query('SELECT * FROM course_sessions WHERE id = $1', [sessionId]);
    const result = await db.query('UPDATE course_sessions SET is_cancelled = TRUE, updated_at = NOW() WHERE id = $1 RETURNING *', [sessionId]);
    await logAdminAction({ adminId: req.admin.id, actionType: 'session_cancel', entityType: 'session', entityId: sessionId, oldValues: before.rows[0], newValues: result.rows[0] });
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

router.get('/courses/:courseId/enrollments', requireAdminAuth, async (req, res, next) => {
  try {
    const courseId = Number(req.params.courseId);
    const result = await db.query('SELECT * FROM course_enrollments WHERE course_id = $1 ORDER BY created_at DESC', [courseId]);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
});

router.post('/courses/:courseId/enrollments', requireAdminAuth, async (req, res, next) => {
  try {
    const courseId = Number(req.params.courseId);
    const payload = validateEnrollmentPayload(req.body);
    const result = await db.query(
      `INSERT INTO course_enrollments (course_id, phone, email, first_name, last_name)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [courseId, payload.phone, payload.email, payload.first_name, payload.last_name]
    );
    await logAdminAction({ adminId: req.admin.id, actionType: 'enrollment_add', entityType: 'enrollment', entityId: result.rows[0].id, newValues: result.rows[0] });
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

router.delete('/enrollments/:enrollmentId', requireAdminAuth, async (req, res, next) => {
  try {
    const enrollmentId = Number(req.params.enrollmentId);
    const before = await db.query('SELECT * FROM course_enrollments WHERE id = $1', [enrollmentId]);
    await db.query('DELETE FROM course_enrollments WHERE id = $1', [enrollmentId]);
    await logAdminAction({ adminId: req.admin.id, actionType: 'enrollment_delete', entityType: 'enrollment', entityId: enrollmentId, oldValues: before.rows[0] });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.put('/courses/:courseId/enrollments/replace', requireAdminAuth, async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    const courseId = Number(req.params.courseId);
    const payload = validateEnrollmentReplacePayload(req.body);

    await client.query('BEGIN');
    const before = await client.query('SELECT * FROM course_enrollments WHERE course_id = $1', [courseId]);
    await client.query('DELETE FROM course_enrollments WHERE course_id = $1', [courseId]);
    for (const row of payload.rows) {
      await client.query(
        `INSERT INTO course_enrollments (course_id, phone, email, first_name, last_name)
         VALUES ($1, $2, $3, $4, $5)`,
        [courseId, row.phone, row.email, row.first_name, row.last_name]
      );
    }
    const after = await client.query('SELECT * FROM course_enrollments WHERE course_id = $1', [courseId]);
    await client.query('COMMIT');

    await logAdminAction({ adminId: req.admin.id, actionType: 'enrollment_replace', entityType: 'course', entityId: courseId, oldValues: before.rows, newValues: after.rows });
    res.json({ success: true, data: { replaced_count: after.rowCount } });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
});

router.get('/courses/:courseId/attendance', requireAdminAuth, async (req, res, next) => {
  try {
    const courseId = Number(req.params.courseId);
    const sessions = await db.query(
      `SELECT id, course_id, session_date::text AS session_date, start_time, end_time, is_cancelled, created_at, updated_at
       FROM course_sessions
       WHERE course_id = $1
       ORDER BY session_date ASC`,
      [courseId]
    );
    const matrix = await db.query(
      `SELECT p.id AS participant_id, p.first_name, p.last_name, p.phone, p.email,
          s.id AS session_id, s.session_date::text AS session_date, ar.id AS attendance_id, ar.source, ar.removed_at
       FROM course_participants cp
       JOIN participants p ON p.id = cp.participant_id
       CROSS JOIN LATERAL (
          SELECT id, session_date FROM course_sessions WHERE course_id = cp.course_id
       ) s
       LEFT JOIN attendance_records ar ON ar.session_id = s.id AND ar.participant_id = p.id
       WHERE cp.course_id = $1
       ORDER BY p.last_name, p.first_name, s.session_date`,
      [courseId]
    );

    res.json({ success: true, data: { sessions: sessions.rows, rows: matrix.rows } });
  } catch (error) {
    next(error);
  }
});

router.put('/attendance', requireAdminAuth, async (req, res, next) => {
  try {
    const payload = validateAttendanceUpdatePayload(req.body);
    const existing = await db.query(
      'SELECT * FROM attendance_records WHERE session_id = $1 AND participant_id = $2',
      [payload.session_id, payload.participant_id]
    );
    const oldValue = existing.rows[0] || null;

    let newValue;
    if (payload.present) {
      if (oldValue) {
        const updated = await db.query(
          `UPDATE attendance_records
           SET removed_at = NULL, source = 'admin_manual', notes = $3, marked_at = NOW()
           WHERE session_id = $1 AND participant_id = $2
           RETURNING *`,
          [payload.session_id, payload.participant_id, payload.notes]
        );
        newValue = updated.rows[0];
      } else {
        const inserted = await db.query(
          `INSERT INTO attendance_records (session_id, participant_id, source, notes)
           VALUES ($1, $2, 'admin_manual', $3)
           RETURNING *`,
          [payload.session_id, payload.participant_id, payload.notes]
        );
        newValue = inserted.rows[0];
      }
    } else {
      const updated = await db.query(
        `UPDATE attendance_records
         SET removed_at = NOW(), source = 'admin_manual', notes = $3
         WHERE session_id = $1 AND participant_id = $2
         RETURNING *`,
        [payload.session_id, payload.participant_id, payload.notes]
      );
      newValue = updated.rows[0] || null;
    }

    await logAdminAction({ adminId: req.admin.id, actionType: 'attendance_override', entityType: 'attendance', entityId: newValue?.id || oldValue?.id || null, oldValues: oldValue, newValues: newValue });
    res.json({ success: true, data: newValue });
  } catch (error) {
    next(error);
  }
});

router.get('/participants', requireAdminAuth, async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const { pageSize, offset } = parsePagination(req.query);
    const result = await db.query(
      `SELECT * FROM participants
       WHERE $1 = ''
          OR lower(first_name || ' ' || last_name) LIKE '%' || $1 || '%'
          OR phone_normalized LIKE '%' || regexp_replace($1, '\\D', '', 'g') || '%'
          OR lower(coalesce(email, '')) LIKE '%' || $1 || '%'
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [q, pageSize, offset]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
});

router.get('/participants/:participantId', requireAdminAuth, async (req, res, next) => {
  try {
    const participantId = Number(req.params.participantId);
    const [participant, courses, attendance] = await Promise.all([
      db.query('SELECT * FROM participants WHERE id = $1', [participantId]),
      db.query(`SELECT c.* FROM course_participants cp JOIN courses c ON c.id = cp.course_id WHERE cp.participant_id = $1`, [participantId]),
      db.query(`SELECT ar.*, cs.course_id, cs.session_date FROM attendance_records ar JOIN course_sessions cs ON cs.id = ar.session_id WHERE ar.participant_id = $1 ORDER BY ar.marked_at DESC`, [participantId])
    ]);

    res.json({ success: true, data: { participant: participant.rows[0], courses: courses.rows, attendance: attendance.rows } });
  } catch (error) {
    next(error);
  }
});

router.get('/logs', requireAdminAuth, async (req, res, next) => {
  try {
    const { pageSize, offset } = parsePagination(req.query);
    const logs = await getAuditLogs({
      adminId: req.query.admin_id ? Number(req.query.admin_id) : null,
      entityType: req.query.entity_type || null,
      actionType: req.query.action_type || null,
      limit: pageSize,
      offset
    });
    res.json({ success: true, data: logs });
  } catch (error) {
    next(error);
  }
});

router.get('/courses/:courseId/attendance/export', requireAdminAuth, async (req, res, next) => {
  try {
    const courseId = Number(req.params.courseId);
    const sessionsResult = await db.query(
      `SELECT id, session_date::text AS session_date
       FROM course_sessions
       WHERE course_id = $1
       ORDER BY session_date`,
      [courseId]
    );
    const participantsResult = await db.query(
      `SELECT p.id, p.first_name, p.last_name, p.phone, p.email
       FROM course_participants cp JOIN participants p ON p.id = cp.participant_id
       WHERE cp.course_id = $1
       ORDER BY p.last_name, p.first_name`,
      [courseId]
    );

    const attendanceResult = await db.query(
      `SELECT session_id, participant_id, removed_at
       FROM attendance_records ar
       JOIN course_sessions cs ON cs.id = ar.session_id
       WHERE cs.course_id = $1`,
      [courseId]
    );

    const attendanceMap = new Map(attendanceResult.rows.map((row) => [`${row.participant_id}:${row.session_id}`, !row.removed_at]));
    const headers = ['Name', 'Phone', 'Email', ...sessionsResult.rows.map((s) => s.session_date)];
    const lines = [headers.join(',')];

    for (const p of participantsResult.rows) {
      const row = [`${p.first_name} ${p.last_name}`.trim(), p.phone || '', p.email || ''];
      for (const s of sessionsResult.rows) {
        row.push(attendanceMap.get(`${p.id}:${s.id}`) ? 'Present' : 'Absent');
      }
      lines.push(row.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(','));
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="course_${courseId}_attendance.csv"`);
    res.send(lines.join('\n'));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
