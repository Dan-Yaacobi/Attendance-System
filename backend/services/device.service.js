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
    `SELECT cp.course_id
     FROM course_participants cp
     WHERE cp.participant_id = $1
       AND cp.course_id = $2
     UNION
     SELECT ce.course_id
     FROM participants p
     JOIN course_enrollments ce
       ON ce.course_id = $2
      AND (
        regexp_replace(COALESCE(ce.phone, ''), '\D', '', 'g') = p.phone_normalized
        OR lower(trim(COALESCE(ce.email, ''))) = p.email_normalized
      )
     WHERE p.id = $1
     LIMIT 1`,
    [participantId, courseId]
  );

  if (!assignmentResult.rows[0]) {
    throw createServiceError(
      'NOT_ASSIGNED_TO_COURSE',
      'Participant is not assigned to this course.',
      403
    );
  }

  await db.query(
    `INSERT INTO course_participants (course_id, participant_id)
     VALUES ($1, $2)
     ON CONFLICT (course_id, participant_id) DO NOTHING`,
    [courseId, participantId]
  );
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
    `SELECT pd.device_uuid, pd.participant_id, p.first_name, p.last_name
     FROM participant_devices as pd
     JOIN participants p
       ON p.id = pd.participant_id
     WHERE pd.device_uuid = $1
       AND pd.is_revoked = FALSE`,
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
    participant: {
      id: device.participant_id,
      first_name: device.first_name,
      last_name: device.last_name
    },
    session_id: session.id,
    already_marked: attendanceResult.already_marked,
    ...(attendanceResult.code ? { code: attendanceResult.code } : {})
  };
}

module.exports = {
  markAttendanceByDevice
};
