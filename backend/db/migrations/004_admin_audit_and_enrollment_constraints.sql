ALTER TABLE admin_audit_logs
  ALTER COLUMN admin_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_course_enrollments_phone
  ON course_enrollments (course_id, regexp_replace(COALESCE(phone, ''), '\\D', '', 'g'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_course_enrollments_email
  ON course_enrollments (course_id, lower(trim(COALESCE(email, ''))));
