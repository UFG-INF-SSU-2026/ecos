const { WebSocketServer, WebSocket } = require('ws');
const { sessionUser } = require('./auth');

async function attachRealtime(server, pool) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  let listener;
  let retry;
  let closing = false;
  async function listen() {
    try {
      listener = await pool.connect();
      listener.on('notification', notification => {
        const data = JSON.parse(notification.payload);
        for (const ws of wss.clients) if (ws.userId === data.userId && ws.readyState === WebSocket.OPEN) {
          if (ws.bufferedAmount > 65536) { ws.close(1013, 'Reconecte e consulte o histórico.'); continue; }
          ws.send(JSON.stringify({ type: 'events.changed', deviceId: data.deviceId }));
        }
      });
      listener.once('error', () => {
        listener.release(true); listener = null;
        // Desconectar força o app a refazer a sincronização após falha do LISTEN.
        for (const ws of wss.clients) ws.close(1012, 'Reconectando banco.');
        if (!closing) retry = setTimeout(listen, 2000);
      });
      await listener.query('LISTEN ecos_events');
    } catch (error) {
      if (listener) { listener.release(true); listener = null; }
      if (!closing) retry = setTimeout(listen, 2000);
      console.error('Realtime indisponível:', error.message);
    }
  }
  await listen();
  server.on('upgrade', (req, socket, head) => {
    const secure = req.socket.encrypted || (process.env.TRUST_PROXY === '1' && req.headers['x-forwarded-proto'] === 'https');
    if (req.url !== '/api/v1/stream' || (process.env.NODE_ENV === 'production' && !secure)) {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'); return;
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  });
  wss.on('connection', ws => {
    ws.on('error', () => {});
    const timeout = setTimeout(() => ws.close(1008, 'Autenticação obrigatória.'), 5000);
    ws.once('close', () => clearTimeout(timeout));
    let authenticating = false;
    ws.on('message', async raw => {
      if (ws.userId || authenticating) return;
      authenticating = true;
      try {
        const message = JSON.parse(raw.toString());
        if (message.type !== 'auth' || typeof message.token !== 'string') throw new Error('invalid');
        const user = await sessionUser(pool, message.token);
        if (!user) throw new Error('invalid');
        clearTimeout(timeout);
        ws.userId = user.id;
        ws.token = message.token;
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ready' }));
      } catch { ws.close(1008, 'Sessão inválida.'); }
    });
  });
  const heartbeat = setInterval(async () => {
    for (const ws of wss.clients) {
      if (!ws.userId) continue;
      try {
        if (!await sessionUser(pool, ws.token)) { ws.close(1008, 'Sessão expirada.'); continue; }
        if (ws.alive === false) { ws.terminate(); continue; }
        ws.alive = false;
        ws.once('pong', () => { ws.alive = true; });
        ws.ping();
      } catch { ws.close(1012, 'Banco indisponível.'); }
    }
  }, 15000);
  heartbeat.unref();
  return { async close() {
    closing = true; clearInterval(heartbeat); clearTimeout(retry);
    for (const ws of wss.clients) ws.terminate();
    await new Promise(resolve => wss.close(resolve));
    if (listener) { await listener.query('UNLISTEN *'); listener.release(); listener = null; }
  } };
}
module.exports = { attachRealtime };
