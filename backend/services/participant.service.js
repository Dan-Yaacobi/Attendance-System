const { v4: uuidv4 } = require('uuid');
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

async function findParticipantByIdentity(phone, email) {
  const normalizedPhone = normalizePhone(phone);
  const normalizedEmail = normalizeEmail(email);

  const byPhoneResult = normalizedPhone
    ? await db.query(
        `SELECT *
         FROM participants
         WHERE phone_normalized = $1`,
        [normalizedPhone]
      )
    : { rows: [] };

  const byEmailResult = normalizedEmail
    ? await db.query(
        `SELECT *
         FROM participants
         WHERE email_normalized = $1`,
        [normalizedEmail]
      )
    : { rows: [] };

  const participantByPhone = byPhoneResult.rows[0] || null;
  const participantByEmail = byEmailResult.rows[0] || null;

  if (
    participantByPhone &&
    participantByEmail &&
    participantByPhone.id !== participantByEmail.id
  ) {
    throw createServiceError(
      'PARTICIPANT_IDENTITY_CONFLICT',
      'Phone and email belong to different participants.',
      409
    );
  }

  const participant = participantByPhone || participantByEmail;

  if (!participant) {
    throw createServiceError('PARTICIPANT_NOT_FOUND', 'Participant was not found.', 404);
  }

  return participant;
}

async function ensureParticipantAssignedToCourse(participantId, courseId) {
  const assignmentResult = await db.query(
    `SELECT course_id, participant_id
     FROM course_participants
     WHERE participant_id = $1
       AND course_id = $2`,
    [participantId, courseId]
  );

  if (!assignmentResult.rows[0]) {
    throw createServiceError(
      'NOT_ASSIGNED_TO_COURSE',
      'Participant is not assigned to this course.',
      403
    );
  }
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
  const participant = await findParticipantByIdentity(payload.phone, payload.email);
  const { course, session } = await validateSessionForToday(payload.course_id);

  await ensureParticipantAssignedToCourse(participant.id, course.id);

  const deviceUuid = uuidv4();

  await db.query(
    `INSERT INTO participant_devices (device_uuid, participant_id)
     VALUES ($1, $2)`,
    [deviceUuid, participant.id]
  );

  const attendanceResult = await insertAttendanceRecord(session.id, participant.id, deviceUuid);

  return {
    device_uuid: deviceUuid,
    participant_id: participant.id,
    session_id: session.id,
    already_marked: attendanceResult.already_marked,
    ...(attendanceResult.code ? { code: attendanceResult.code } : {})
  };
}

module.exports = {
  signInAndMarkAttendance
};
