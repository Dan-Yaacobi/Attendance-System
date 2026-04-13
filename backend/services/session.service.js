const db = require('../db');

function createServiceError(code, message, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

async function validateSessionForToday(sapCourseId) {
  const courseResult = await db.query(
    `SELECT id, sap_course_id, course_title
     FROM courses
     WHERE sap_course_id = $1`,
    [sapCourseId]
  );

  const course = courseResult.rows[0];

  if (!course) {
    throw createServiceError('COURSE_NOT_FOUND', 'Course was not found.', 404);
  }

  const sessionResult = await db.query(
    `SELECT id, session_date::text AS session_date, start_time, end_time
     FROM course_sessions
     WHERE course_id = $1
       AND session_date = CURRENT_DATE
       AND is_cancelled = FALSE`,
    [course.id]
  );

  const session = sessionResult.rows[0];

  if (!session) {
    throw createServiceError('NO_SESSION_TODAY', 'No active session found for today.', 404);
  }

  return {
    course,
    session
  };
}

module.exports = {
  validateSessionForToday
};
