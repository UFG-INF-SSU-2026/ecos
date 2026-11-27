const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const bearer = request => /^Bearer (\S+)$/i.exec(request.headers.authorization || '')?.[1] || '';
async function passwordHash(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = await scrypt(password, salt, 64);
  return `${salt}:${derived.toString('hex')}`;
}
async function verifyPassword(password, stored) {
  const actual = await passwordHash(password, stored.split(':')[0]);
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(stored));
}
async function sessionUser(pool, token) {
  const { rows } = await pool.query(`SELECT u.id, u.name, u.email, s.expires_at FROM sessions s
    JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()`, [hash(token)]);
  return rows[0];
}
function userAuth(pool) {
  return async (req, res, next) => {
    const user = await sessionUser(pool, bearer(req));
    if (!user) return res.status(401).json({ error: 'Sessão inválida ou expirada. Entre novamente.' });
    req.user = user;
    next();
  };
}
function deviceAuth(pool) {
  return async (req, res, next) => {
    const { rows } = await pool.query('SELECT * FROM devices WHERE id=$1 AND token_hash=$2',
      [req.headers['x-device-id'] || '', hash(bearer(req))]);
    if (!rows[0]) return res.status(401).json({ error: 'Credencial do dispositivo inválida.' });
    req.device = rows[0];
    next();
  };
}
module.exports = { hash, bearer, passwordHash, verifyPassword, sessionUser, userAuth, deviceAuth };
