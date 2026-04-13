function createValidationError(message) {
  const error = new Error(message);
  error.code = 'VALIDATION_ERROR';
  error.status = 400;
  return error;
}

function requireNonEmptyString(payload, fieldName) {
  if (!payload || typeof payload[fieldName] !== 'string') {
    throw createValidationError(`${fieldName} is required and must be a string.`);
  }

  const value = payload[fieldName].trim();

  if (!value) {
    throw createValidationError(`${fieldName} cannot be empty.`);
  }

  return value;
}

function validateAttendanceEntryPayload(payload) {
  return {
    course_id: requireNonEmptyString(payload, 'course_id')
  };
}

function validateSignInPayload(payload) {
  return {
    course_id: requireNonEmptyString(payload, 'course_id'),
    token: requireNonEmptyString(payload, 'token'),
    email: requireNonEmptyString(payload, 'email'),
    phone: requireNonEmptyString(payload, 'phone')
  };
}

function validateMarkByDevicePayload(payload) {
  return {
    course_id: requireNonEmptyString(payload, 'course_id'),
    device_uuid: requireNonEmptyString(payload, 'device_uuid')
  };
}

module.exports = {
  validateAttendanceEntryPayload,
  validateSignInPayload,
  validateMarkByDevicePayload
};
