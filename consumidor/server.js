const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const { pool } = require('./src/db');
const { createApp } = require('./src/app');
const { attachRealtime } = require('./src/realtime');

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Configure DATABASE_URL e execute npm run db:migrate.');
  await pool.query('SELECT 1 FROM events LIMIT 1');
  const key = process.env.TLS_KEY_PATH;
  const cert = process.env.TLS_CERT_PATH;
  if (Boolean(key) !== Boolean(cert)) throw new Error('Configure os dois caminhos TLS juntos.');
  const app = createApp(pool);
  const server = key
    ? https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, app)
    : http.createServer(app);
  const realtime = await attachRealtime(server, pool);
  server.listen(Number(process.env.PORT || 3000), process.env.HOST || '0.0.0.0', () => {
    console.log('ECOS: API e WebSocket na porta', server.address().port);
  });
  async function stop() {
    await realtime.close();
    server.close(async () => { await pool.end(); process.exit(0); });
    setTimeout(() => process.exit(1), 5000).unref();
  }
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exit(1); });
