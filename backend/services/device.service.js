const db = require('../db');
const { validateSessionForToday } = require('./session.service');

function createServiceError(code, message, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
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

async function markAttendanceByDevice(payload) {
  const deviceResult = await db.query(
    `SELECT device_uuid, participant_id
     FROM participant_devices
     WHERE device_uuid = $1
       AND is_revoked = FALSE`,
    [payload.device_uuid]
  );

  const device = deviceResult.rows[0];

  if (!device) {
    throw createServiceError('INVALID_DEVICE_UUID', 'Device UUID is invalid.', 404);
  }

  const { course, session } = await validateSessionForToday(payload.course_id);

  await ensureParticipantAssignedToCourse(device.participant_id, course.id);

  const attendanceResult = await insertAttendanceRecord(
    session.id,
    device.participant_id,
    device.device_uuid
  );

  return {
    participant_id: device.participant_id,
    session_id: session.id,
    already_marked: attendanceResult.already_marked,
    ...(attendanceResult.code ? { code: attendanceResult.code } : {})
  };
}

module.exports = {
  markAttendanceByDevice
};
