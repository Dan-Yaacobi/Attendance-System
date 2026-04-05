function createValidationError(message) {
  const error = new Error(message);
  error.code = 'VALIDATION_ERROR';
  error.status = 400;
  return error;
}

function validateAttendanceEntryPayload(payload) {
  if (!payload || typeof payload.course_id !== 'string') {
    throw createValidationError('course_id is required and must be a string.');
  }

  const courseId = payload.course_id.trim();

  if (!courseId) {
    throw createValidationError('course_id cannot be empty.');
  }

  return {
    course_id: courseId
  };
}

module.exports = {
  validateAttendanceEntryPayload
};
