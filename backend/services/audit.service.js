const db = require('../db');

function serializeJson(value) {
  if (value === null || value === undefined) return null;
  return JSON.stringify(value);
}

async function logAdminAction({ adminId = null, actionType, entityType, entityId = null, oldValues = null, newValues = null }) {
  await db.query(
    `INSERT INTO admin_audit_logs (admin_id, action_type, entity_type, entity_id, old_values, new_values)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [adminId, actionType, entityType, entityId, serializeJson(oldValues), serializeJson(newValues)]
  );
}

async function getAuditLogs({ adminId, entityType, actionType, limit, offset }) {
  const filters = [];
  const params = [];

  if (adminId) {
    params.push(adminId);
    filters.push(`l.admin_id = $${params.length}`);
  }
  if (entityType) {
    params.push(entityType);
    filters.push(`l.entity_type = $${params.length}`);
  }
  if (actionType) {
    params.push(actionType);
    filters.push(`l.action_type = $${params.length}`);
  }

  params.push(limit);
  const limitIdx = params.length;
  params.push(offset);
  const offsetIdx = params.length;

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  const result = await db.query(
    `SELECT l.*, a.email AS admin_email, a.full_name AS admin_name
     FROM admin_audit_logs l
     LEFT JOIN admins a ON a.id = l.admin_id
     ${where}
     ORDER BY l.created_at DESC
     LIMIT $${limitIdx}
     OFFSET $${offsetIdx}`,
    params
  );

  return result.rows;
}

module.exports = {
  logAdminAction,
  getAuditLogs
};
