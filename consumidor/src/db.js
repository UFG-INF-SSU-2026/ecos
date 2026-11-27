const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10,
  connectionTimeoutMillis: 5000, statement_timeout: 10000 });
pool.on('error', error => console.error('Conexão com banco interrompida:', error.message));
async function transaction(pool, action) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
// NOTIFY só é entregue no COMMIT. O aplicativo recupera o histórico via REST.
async function appendEvent(client, { userId, deviceId, eventId, eventType, payload }) {
  const { rows } = await client.query(`INSERT INTO events(user_id, device_id, event_id, event_type, payload)
    VALUES ($1,$2,$3,$4,$5) RETURNING *`, [userId, deviceId, eventId, eventType, payload]);
  await client.query("SELECT pg_notify('ecos_events', $1)", [JSON.stringify({ userId, deviceId })]);
  return rows[0];
}
module.exports = { pool, transaction, appendEvent };
