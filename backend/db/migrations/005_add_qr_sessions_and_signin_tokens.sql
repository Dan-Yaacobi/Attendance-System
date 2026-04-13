CREATE TABLE IF NOT EXISTS qr_sessions (
    session_id TEXT PRIMARY KEY,
    course_id BIGINT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    created_by_admin_id BIGINT REFERENCES admins(id) ON DELETE SET NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qr_sessions_course_id ON qr_sessions(course_id);
CREATE INDEX IF NOT EXISTS idx_qr_sessions_expires_at ON qr_sessions(expires_at);

CREATE TABLE IF NOT EXISTS course_signin_tokens (
    course_id BIGINT PRIMARY KEY REFERENCES courses(id) ON DELETE CASCADE,
    token TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_course_signin_tokens_expires_at ON course_signin_tokens(expires_at);
