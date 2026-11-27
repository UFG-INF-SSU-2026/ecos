const crypto = require('node:crypto');
const { pool, transaction } = require('../src/db');
const { hash, passwordHash } = require('../src/auth');
async function provision() {
  const { USER_EMAIL, USER_PASSWORD, USER_NAME, DEVICE_ID, DEVICE_TOKEN } = process.env;
  if (!USER_EMAIL || !USER_NAME || !USER_PASSWORD || USER_PASSWORD.length < 12 ||
      !/^[A-Za-z0-9._:-]{1,100}$/.test(DEVICE_ID || '') || !DEVICE_TOKEN || DEVICE_TOKEN.length < 32) {
    throw new Error('Configure USER_NAME, USER_EMAIL, USER_PASSWORD (12+), DEVICE_ID e DEVICE_TOKEN (32+).');
  }
  const password = await passwordHash(USER_PASSWORD);
  await transaction(pool, async client => {
    const { rows } = await client.query(`INSERT INTO users(id,name,email,password_hash) VALUES($1,$2,$3,$4)
      ON CONFLICT(email) DO UPDATE SET name=EXCLUDED.name, password_hash=EXCLUDED.password_hash
      RETURNING id`, [crypto.randomUUID(), USER_NAME, USER_EMAIL.trim().toLowerCase(), password]);
    const existing = await client.query('SELECT user_id FROM devices WHERE id=$1 FOR UPDATE', [DEVICE_ID]);
    if (existing.rows[0] && existing.rows[0].user_id !== rows[0].id) {
      throw new Error('O dispositivo já pertence a outro usuário; a transferência não é permitida por este script.');
    }
    await client.query(`INSERT INTO devices(id,user_id,name,token_hash) VALUES($1,$2,$3,$4)
      ON CONFLICT(id) DO UPDATE SET token_hash=EXCLUDED.token_hash`,
    [DEVICE_ID, rows[0].id, process.env.DEVICE_NAME || 'Mesa de estudos', hash(DEVICE_TOKEN)]);
    await client.query('DELETE FROM sessions WHERE user_id=$1', [rows[0].id]);
    console.log('Usuário e dispositivo configurados:', USER_EMAIL, DEVICE_ID);
  });
}
if (require.main === module) provision().then(() => pool.end()).catch(async e => {
  console.error(e.message); await pool.end(); process.exitCode = 1;
});
module.exports = { provision };
