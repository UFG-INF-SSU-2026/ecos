const express = require('express');
const { randomBytes } = require('node:crypto');
const { rateLimit } = require('express-rate-limit');
const { bearer, hash, verifyPassword, passwordHash, userAuth, deviceAuth } = require('./auth');
const { ingest, setEnabled, fail, deviceView, ID } = require('./domain');

function createApp(pool) {
  const app = express();
  app.disable('x-powered-by');
  // Só habilite atrás de um proxy confiável; porta Node não deve ser pública nesse modo.
  app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : false);
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (process.env.NODE_ENV === 'production' && !req.secure) return res.status(426).json({ error: 'Use HTTPS.' });
    next();
  });
  app.use(express.json({ limit: '4kb' }));
  const mobile = userAuth(pool);
  const sensor = deviceAuth(pool);
  // Mesmo custo scrypt para usuários inexistentes.
  const dummyHash = passwordHash('dummy-password-never-used');
  app.get('/health', async (_req, res) => { await pool.query('SELECT 1'); res.json({ status: 'ok' }); });
  app.post('/api/v1/auth/login', rateLimit({ windowMs: 15 * 60000, limit: 20, standardHeaders: 'draft-7',
    legacyHeaders: false, message: { error: 'Muitas tentativas. Aguarde 15 minutos.' } }), async (req, res) => {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string' || email.length > 254 || password.length > 256)
      fail(400, 'Informe e-mail e senha.');
    const { rows: [user] } = await pool.query('SELECT * FROM users WHERE email=$1', [email.trim().toLowerCase()]);
    const valid = await verifyPassword(password, user?.password_hash || await dummyHash);
    if (!user || !valid) fail(401, 'E-mail ou senha incorretos.');
    const token = randomBytes(32).toString('hex');
    const { rows: [session] } = await pool.query(`INSERT INTO sessions(token_hash,user_id,expires_at)
      VALUES($1,$2,now()+interval '7 days') RETURNING expires_at`, [hash(token), user.id]);
    await pool.query('DELETE FROM sessions WHERE expires_at < now()');
    res.json({ token, expiresAt: session.expires_at, user: { id: user.id, name: user.name, email: user.email } });
  });
  app.get('/api/v1/me', mobile, (req, res) => res.json({ user: req.user }));
  app.post('/api/v1/auth/logout', mobile, async (req, res) => {
    await pool.query('DELETE FROM sessions WHERE token_hash=$1', [hash(bearer(req))]);
    res.status(204).end();
  });
  app.get('/api/v1/devices', mobile, async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM devices WHERE user_id=$1 ORDER BY id', [req.user.id]);
    res.json({ devices: rows.map(deviceView) });
  });
  app.post('/api/v1/devices/:id/commands', mobile, async (req, res) => {
    res.status(202).json(await setEnabled(pool, req.user.id, req.params.id, req.body));
  });
  app.get('/api/v1/device/config', sensor, async (req, res) => {
    await pool.query('UPDATE devices SET last_seen_at=clock_timestamp() WHERE id=$1', [req.device.id]);
    res.json({ deviceId: req.device.id, enabled: req.device.desired_enabled, version: req.device.desired_version });
  });
  app.post('/api/v1/eventos', sensor, async (req, res) => res.json(await ingest(pool, req.device, req.body)));
  app.get(['/api/v1/events', '/api/v1/breaks'], mobile, async (req, res) => {
    const limit = req.query.limit === undefined ? 50 : Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail(400, 'limit deve ser de 1 a 100.');
    const params = [req.user.id];
    const where = ['user_id=$1'];
    const breaksOnly = req.path === '/api/v1/breaks';
    if (breaksOnly) where.push("event_type='study.break.notification'");
    for (const [key, column] of [['deviceId', 'device_id'], ['eventType', 'event_type']]) {
      if (breaksOnly && key === 'eventType') continue;
      if (req.query[key] !== undefined) {
        if (typeof req.query[key] !== 'string' || !ID.test(req.query[key])) fail(400, `${key} inválido.`);
        params.push(req.query[key]); where.push(`${column}=$${params.length}`);
      }
    }
    for (const [key, op] of [['from', '>='], ['to', '<=']]) {
      if (req.query[key] !== undefined) {
        if (typeof req.query[key] !== 'string' || !Number.isFinite(Date.parse(req.query[key]))) fail(400, `${key} inválido.`);
        params.push(new Date(req.query[key]).toISOString()); where.push(`time${op}$${params.length}`);
      }
    }
    if (req.query.cursor) {
      let cursor;
      try { cursor = JSON.parse(Buffer.from(req.query.cursor, 'base64url').toString()); } catch { fail(400, 'Cursor inválido.'); }
      if (!Array.isArray(cursor) || cursor.length !== 2 || !Number.isFinite(Date.parse(cursor[0])) || !/^\d+$/.test(cursor[1]))
        fail(400, 'Cursor inválido.');
      params.push(cursor[0], cursor[1]);
      where.push(`(time,id)<($${params.length - 1}::timestamptz,$${params.length}::bigint)`);
    }
    params.push(limit + 1);
    const { rows } = await pool.query(`SELECT *, to_char(time AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time FROM events WHERE ${where.join(' AND ')}
      ORDER BY time DESC,id DESC LIMIT $${params.length}`, params);
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    res.json({ events: page.map(r => ({ id: r.id, time: r.time, eventId: r.event_id,
      userId: r.user_id, deviceId: r.device_id, eventType: r.event_type, payload: r.payload })),
    nextCursor: rows.length > limit ? Buffer.from(JSON.stringify([last.cursor_time, last.id])).toString('base64url') : null });
  });
  app.use((error, _req, res, _next) => {
    const status = error.status || (error.code === '23505' ? 409 : 500);
    if (status >= 500) console.error('Falha na API:', error.message);
    res.status(status).json({ error: status >= 500 ? 'Serviço indisponível. Tente novamente.' : error.message });
  });
  return app;
}
module.exports = { createApp };
