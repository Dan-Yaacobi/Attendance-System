const { randomUUID } = require('node:crypto');
const db = require('../db');
const { validateSessionForToday } = require('./session.service');

function createServiceError(code, message, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

async function ensureEnrollmentEligibility(courseId, phone, email) {
  const eligibilityResult = await db.query(
    `SELECT *
     FROM course_enrollments
     WHERE course_id = $1
       AND (phone = $2 OR email = $3)
     LIMIT 1`,
    [courseId, phone, email]
  );

  if (!eligibilityResult.rows[0]) {
    throw createServiceError(
      'NOT_ALLOWED',
      'You are not eligible to sign in for this course.',
      403
    );
  }

  return eligibilityResult.rows[0];
}

async function findOrCreateParticipant(payload, normalizedPhone, normalizedEmail) {
  const participantResult = await db.query(
    `SELECT *
     FROM participants
     WHERE phone_normalized = $1
        OR email_normalized = $2
     LIMIT 1`,
    [normalizedPhone, normalizedEmail]
  );

  if (participantResult.rows[0]) {
    return participantResult.rows[0];
  }

  const insertResult = await db.query(
    `INSERT INTO participants (
        first_name,
        last_name,
        phone,
        phone_normalized,
        email,
        email_normalized
     )
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      payload.first_name,
      payload.last_name,
      payload.phone,
      normalizedPhone,
      payload.email,
      normalizedEmail
    ]
  );

  return insertResult.rows[0];
}

async function insertAttendanceRecord(sessionId, participantId, deviceUuid) {
  try {
    await db.query(
      `INSERT INTO attendance_records (session_id, participant_id, source, device_uuid)
       VALUES ($1, $2, 'qr', $3)`,
      [sessionId, participantId, deviceUuid]
    );

    return { already_marked: false };
  } catch (error) {
    if (error.code === '23505') {
      return { already_marked: true, code: 'ALREADY_MARKED' };
    }

    throw error;
  }
}

async function signInAndMarkAttendance(payload) {
  const normalizedPhone = normalizePhone(payload.phone);
  const normalizedEmail = normalizeEmail(payload.email);
  const { course, session } = await validateSessionForToday(payload.course_id);

  await ensureEnrollmentEligibility(course.id, normalizedPhone, normalizedEmail);
  const participant = await findOrCreateParticipant(payload, normalizedPhone, normalizedEmail);

  const deviceUuid = randomUUID();

  await db.query(
    `INSERT INTO participant_devices (device_uuid, participant_id)
     VALUES ($1, $2)`,
    [deviceUuid, participant.id]
  );

  const attendanceResult = await insertAttendanceRecord(session.id, participant.id, deviceUuid);

  return {
    device_uuid: deviceUuid,
    participant: {
      id: participant.id,
      first_name: participant.first_name,
      last_name: participant.last_name,
      phone: participant.phone,
      email: participant.email
    },
    session_id: session.id,
    already_marked: attendanceResult.already_marked,
    ...(attendanceResult.code ? { code: attendanceResult.code } : {})
  };
}

module.exports = {
  signInAndMarkAttendance
};
