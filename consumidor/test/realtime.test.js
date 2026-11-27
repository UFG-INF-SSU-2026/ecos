// Testes do canal WebSocket (/api/v1/stream) com LISTEN/NOTIFY simulado.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const WebSocket = require('ws');
const { attachRealtime } = require('../src/realtime');
const { hash } = require('../src/auth');
const { fakePool } = require('./helpers/fake-pool');

const users = { [hash('token-ana')]: { id: 'ana' }, [hash('token-bia')]: { id: 'bia' } };
let server, realtime, pool, url;

before(async () => {
  pool = fakePool([[/FROM sessions s/, p => ({ rows: users[p[0]] ? [users[p[0]]] : [] })]]);
  server = http.createServer((_req, res) => res.end());
  realtime = await attachRealtime(server, pool);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  url = `ws://127.0.0.1:${server.address().port}`;
});
after(async () => { await realtime.close(); await new Promise(resolve => server.close(resolve)); });

function open(path = '/api/v1/stream') {
  const ws = new WebSocket(url + path);
  ws.on('error', () => {});
  return ws;
}
function authenticate(token) {
  return new Promise((resolve, reject) => {
    const ws = open();
    ws.once('open', () => ws.send(JSON.stringify({ type: 'auth', token })));
    ws.once('message', raw => JSON.parse(raw).type === 'ready' ? resolve(ws) : reject(new Error(String(raw))));
    ws.once('close', code => reject(new Error('fechado ' + code)));
  });
}
const closeCode = ws => new Promise(resolve => ws.once('close', code => resolve(code)));
const notify = payload => pool.client.emit('notification', { payload: JSON.stringify(payload) });

describe('WebSocket do aplicativo', () => {
  test('assina o canal ecos_events do PostgreSQL ao iniciar', () => {
    assert(pool.calls.some(c => c.sql === 'LISTEN ecos_events'));
  });
  test('rota diferente de /api/v1/stream é recusada', async () => {
    const ws = open('/outra-rota');
    const result = await new Promise(resolve => { ws.once('unexpected-response', () => resolve('recusado'));
      ws.once('close', () => resolve('recusado')); ws.once('open', () => resolve('aberto')); });
    assert.equal(result, 'recusado');
  });
  test('sessão válida recebe {type:"ready"}', async () => {
    const ws = await authenticate('token-ana');
    ws.terminate();
  });
  test('token inválido (ou de sensor) fecha a conexão com código 1008', async () => {
    const ws = open();
    ws.once('open', () => ws.send(JSON.stringify({ type: 'auth', token: 'token-do-sensor' })));
    assert.equal(await closeCode(ws), 1008);
  });
  test('mensagem que não é JSON de autenticação fecha com 1008', async () => {
    const ws = open();
    ws.once('open', () => ws.send('isto não é json'));
    assert.equal(await closeCode(ws), 1008);
  });
  test('aviso events.changed chega somente ao dono do evento', async () => {
    const ana = await authenticate('token-ana');
    const bia = await authenticate('token-bia');
    let biaMessages = 0;
    bia.on('message', () => biaMessages++);
    const received = new Promise(resolve => ana.once('message', raw => resolve(JSON.parse(raw))));
    notify({ userId: 'ana', deviceId: 'esp32-mesa-01' });
    assert.deepEqual(await received, { type: 'events.changed', deviceId: 'esp32-mesa-01' });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(biaMessages, 0);
    ana.terminate(); bia.terminate();
  });
  test('conexão sem autenticação é encerrada após 5 segundos (1008)', { timeout: 8000 }, async () => {
    const ws = open();
    const started = Date.now();
    assert.equal(await closeCode(ws), 1008);
    assert(Date.now() - started >= 4500);
  });
});
