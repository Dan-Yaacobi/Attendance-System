const crypto = require('node:crypto');
const db = require('../db');

const SESSION_COOKIE_NAME = 'admin_session';

function parseCookies(header) {
  if (!header) return {};

  return header.split(';').reduce((acc, part) => {
    const [key, ...rest] = part.trim().split('=');
    if (!key) return acc;
    acc[key] = decodeURIComponent(rest.join('='));
    return acc;
  }, {});
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function requireAdminAuth(req, res, next) {
  try {
    const cookies = parseCookies(req.headers.cookie || '');
    const token = cookies[SESSION_COOKIE_NAME];

    if (!token) {
      return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
    }

    const tokenHash = hashToken(token);
    const result = await db.query(
      `SELECT s.id, s.admin_id, a.email, a.full_name
       FROM admin_sessions s
       JOIN admins a ON a.id = s.admin_id
       WHERE s.session_token_hash = $1
         AND s.revoked_at IS NULL
         AND s.expires_at > NOW()
         AND a.is_active = TRUE`,
      [tokenHash]
    );

    const session = result.rows[0];
    if (!session) {
      return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
    }

    req.admin = {
      id: session.admin_id,
      email: session.email,
      full_name: session.full_name,
      session_id: session.id
    };

    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  SESSION_COOKIE_NAME,
  hashToken,
  requireAdminAuth
};
