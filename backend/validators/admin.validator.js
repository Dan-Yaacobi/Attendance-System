function createValidationError(message) {
  const error = new Error(message);
  error.code = 'VALIDATION_ERROR';
  error.status = 400;
  return error;
}

function requireString(value, fieldName) {
  if (typeof value !== 'string' || !value.trim()) {
    throw createValidationError(`${fieldName} is required.`);
  }

  return value.trim();
}

function parsePagination(query) {
  const page = Math.max(parseInt(query.page || '1', 10), 1);
  const pageSize = Math.min(Math.max(parseInt(query.page_size || '20', 10), 1), 100);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function validateAdminLoginPayload(body) {
  return {
    email: requireString(body?.email, 'email').toLowerCase(),
    password: requireString(body?.password, 'password')
  };
}

function validateCoursePayload(body) {
  return {
    sap_course_id: requireString(body?.sap_course_id, 'sap_course_id'),
    course_title: requireString(body?.course_title, 'course_title'),
    month: Number(body?.month),
    year: Number(body?.year)
  };
}

function validateSessionPayload(body) {
  const session_date = requireString(body?.session_date, 'session_date');
  return {
    session_date,
    start_time: body?.start_time || null,
    end_time: body?.end_time || null
  };
}

function validateEnrollmentPayload(body) {
  return {
    phone: requireString(body?.phone, 'phone'),
    email: requireString(body?.email, 'email').toLowerCase(),
    first_name: (body?.first_name || '').trim() || null,
    last_name: (body?.last_name || '').trim() || null
  };
}

function validateEnrollmentReplacePayload(body) {
  if (!Array.isArray(body?.rows) || body.rows.length === 0) {
    throw createValidationError('rows must be a non-empty array.');
  }

  return {
    rows: body.rows.map(validateEnrollmentPayload)
  };
}

function validateEnrollmentUpdatePayload(body) {
  if (!body || typeof body !== 'object') {
    throw createValidationError('body is required.');
  }

  const hasAnyField = ['phone', 'email', 'first_name', 'last_name'].some((field) => Object.prototype.hasOwnProperty.call(body, field));
  if (!hasAnyField) {
    throw createValidationError('At least one enrollment field is required.');
  }

  const payload = {};
  if (Object.prototype.hasOwnProperty.call(body, 'phone')) {
    payload.phone = requireString(body.phone, 'phone');
  }
  if (Object.prototype.hasOwnProperty.call(body, 'email')) {
    payload.email = requireString(body.email, 'email').toLowerCase();
  }
  if (Object.prototype.hasOwnProperty.call(body, 'first_name')) {
    payload.first_name = (body.first_name || '').trim() || null;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'last_name')) {
    payload.last_name = (body.last_name || '').trim() || null;
  }

  return payload;
}

function validateAttendanceUpdatePayload(body) {
  return {
    participant_id: Number(body?.participant_id),
    session_id: Number(body?.session_id),
    present: Boolean(body?.present),
    notes: (body?.notes || '').trim() || null
  };
}

module.exports = {
  parsePagination,
  validateAdminLoginPayload,
  validateCoursePayload,
  validateSessionPayload,
  validateEnrollmentPayload,
  validateEnrollmentReplacePayload,
  validateEnrollmentUpdatePayload,
  validateAttendanceUpdatePayload
};
