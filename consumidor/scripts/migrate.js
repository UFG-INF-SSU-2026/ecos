const fs = require('node:fs');
const path = require('node:path');
const { pool, transaction } = require('../src/db');
async function migrate() {
  await transaction(pool, async client => {
    await client.query('SELECT pg_advisory_xact_lock(70132001)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY)');
    const folder = path.join(__dirname, '../migrations');
    for (const name of fs.readdirSync(folder).filter(n => n.endsWith('.sql')).sort()) {
      const { rowCount } = await client.query('SELECT 1 FROM schema_migrations WHERE name=$1', [name]);
      if (rowCount) continue;
      await client.query(fs.readFileSync(path.join(folder, name), 'utf8'));
      await client.query('INSERT INTO schema_migrations VALUES ($1)', [name]);
      console.log('Migração aplicada:', name);
    }
  });
}
if (require.main === module) migrate().then(() => pool.end()).catch(async e => {
  console.error(e.message); await pool.end(); process.exitCode = 1;
});
module.exports = { migrate };
