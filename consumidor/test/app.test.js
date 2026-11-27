// Testes das rotas HTTP (Express) com banco simulado: autenticação, validação de entrada,
// cabeçalhos de segurança, tratamento de erros e montagem da consulta de histórico.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../src/app');
const { hash, passwordHash } = require('../src/auth');
const { fakePool } = require('./helpers/fake-pool');

const USER = { id: '11111111-1111-4111-8111-111111111111', name: 'Ana Liz', email: 'ana@example.com' };
const SESSION = 'sessao-valida';
const DEVICE_TOKEN = 'token-do-dispositivo';
const DEVICE = { id: 'esp32-mesa-01', user_id: USER.id, name: 'Mesa', desired_enabled: false, desired_version: 3 };

async function start(pool) {
  const server = http.createServer(createApp(pool));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(path, { method = 'GET', token, body, headers = {}, raw } = {}) {
    const response = await fetch(base + path, { method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json', ...headers },
      ...(raw !== undefined ? { body: raw } : body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const text = await response.text();
    return { status: response.status, headers: response.headers, data: text ? JSON.parse(text) : null };
  }
  return { call, close: () => new Promise(resolve => server.close(resolve)) };
}

let api, pool, stored;
before(async () => {
  stored = await passwordHash('senha-correta-123');
  pool = fakePool([
    [/FROM sessions s/, p => ({ rows: p[0] === hash(SESSION) ? [USER] : [] })],
    [/SELECT \* FROM users WHERE email/, p => ({ rows: p[0] === USER.email ? [{ ...USER, password_hash: stored }] : [] })],
    [/INSERT INTO sessions/, () => ({ rows: [{ expires_at: new Date('2030-01-01T00:00:00Z') }] })],
    [/FROM devices WHERE id=\$1 AND token_hash/, p => ({ rows: p[0] === DEVICE.id && p[1] === hash(DEVICE_TOKEN) ? [DEVICE] : [] })],
    [/SELECT \* FROM devices WHERE user_id/, () => ({ rows: [{ ...DEVICE, reported_enabled: false, reported_version: 3, last_seen_at: null }] })],
    [/FROM events WHERE/, (p) => ({ rows: Array.from({ length: Math.min(3, p.at(-1)) }, (_, i) => ({
      id: String(10 - i), time: new Date(), cursor_time: '2026-11-27T12:00:00.000000Z', event_id: `e${i}`,
      user_id: USER.id, device_id: DEVICE.id, event_type: 'study.break.notification', payload: {} })) })],
  ]);
  api = await start(pool);
});
after(() => api.close());

describe('saúde e cabeçalhos', () => {
  test('GET /health responde ok quando o banco responde', async () => {
    const r = await api.call('/health');
    assert.equal(r.status, 200);
    assert.deepEqual(r.data, { status: 'ok' });
  });
  test('respostas não são armazenadas em cache e não expõem o framework', async () => {
    const r = await api.call('/health');
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(r.headers.get('x-powered-by'), null);
  });
  test('falha do banco vira 500 com mensagem genérica (sem vazar detalhes)', async () => {
    const broken = await start({ query: async () => { throw new Error('senha do banco: xyz'); } });
    const original = console.error; console.error = () => {};
    try {
      const r = await broken.call('/health');
      assert.equal(r.status, 500);
      assert.equal(r.data.error, 'Serviço indisponível. Tente novamente.');
    } finally { console.error = original; await broken.close(); }
  });
  test('em produção, requisições sem HTTPS recebem 426', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try { assert.equal((await api.call('/health')).status, 426); }
    finally { process.env.NODE_ENV = previous; }
  });
  test('corpo acima de 4 KiB é recusado com 413', async () => {
    const r = await api.call('/api/v1/eventos', { method: 'POST', raw: JSON.stringify({ x: 'a'.repeat(5000) }) });
    assert.equal(r.status, 413);
  });
});

describe('login e sessão do aplicativo', () => {
  test('login correto devolve token, validade e usuário (sem hash de senha)', async () => {
    const r = await api.call('/api/v1/auth/login', { method: 'POST', body: { email: ' ANA@example.com ', password: 'senha-correta-123' } });
    assert.equal(r.status, 200);
    assert.match(r.data.token, /^[0-9a-f]{64}$/);
    assert.deepEqual(r.data.user, USER);
    const insert = pool.calls.find(c => /INSERT INTO sessions/.test(c.sql));
    assert.equal(insert.params[0], hash(r.data.token), 'somente o hash da sessão é persistido');
  });
  test('senha errada e usuário inexistente recebem o mesmo 401', async () => {
    const wrong = await api.call('/api/v1/auth/login', { method: 'POST', body: { email: USER.email, password: 'errada' } });
    const missing = await api.call('/api/v1/auth/login', { method: 'POST', body: { email: 'ninguem@example.com', password: 'x' } });
    assert.equal(wrong.status, 401); assert.equal(missing.status, 401);
    assert.equal(wrong.data.error, missing.data.error);
  });
  test('campos ausentes ou com tipo errado recebem 400', async () => {
    for (const body of [{}, { email: USER.email }, { email: 1, password: 'x' }, { email: 'a'.repeat(255), password: 'x' }])
      assert.equal((await api.call('/api/v1/auth/login', { method: 'POST', body })).status, 400);
  });
  test('GET /me devolve o usuário da sessão; sem sessão, 401', async () => {
    assert.deepEqual((await api.call('/api/v1/me', { token: SESSION })).data.user, USER);
    assert.equal((await api.call('/api/v1/me')).status, 401);
    assert.equal((await api.call('/api/v1/me', { token: 'invalida' })).status, 401);
  });
  test('logout apaga a sessão e responde 204', async () => {
    const r = await api.call('/api/v1/auth/logout', { method: 'POST', token: SESSION, body: {} });
    assert.equal(r.status, 204);
    assert(pool.calls.some(c => /DELETE FROM sessions WHERE token_hash/.test(c.sql) && c.params[0] === hash(SESSION)));
  });
  test('login tem limite de 20 tentativas por 15 minutos (429)', async () => {
    const limited = await start(fakePool());
    try {
      let last;
      for (let i = 0; i < 21; i++)
        last = await limited.call('/api/v1/auth/login', { method: 'POST', body: { email: 'x@example.com', password: 'y' } });
      assert.equal(last.status, 429);
    } finally { await limited.close(); }
  });
});

describe('separação de credenciais', () => {
  test('token do sensor não acessa rotas do aplicativo', async () => {
    assert.equal((await api.call('/api/v1/devices', { token: DEVICE_TOKEN })).status, 401);
  });
  test('sessão do aplicativo não publica eventos de sensor', async () => {
    const r = await api.call('/api/v1/eventos', { method: 'POST', token: SESSION, headers: { 'X-Device-Id': DEVICE.id }, body: {} });
    assert.equal(r.status, 401);
  });
  test('ESP32 autenticado lê sua configuração desejada', async () => {
    const r = await api.call('/api/v1/device/config', { token: DEVICE_TOKEN, headers: { 'X-Device-Id': DEVICE.id } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data, { deviceId: DEVICE.id, enabled: false, version: 3 });
  });
  test('ESP32 com contrato inválido recebe 400 antes de qualquer escrita', async () => {
    const r = await api.call('/api/v1/eventos', { method: 'POST', token: DEVICE_TOKEN,
      headers: { 'X-Device-Id': DEVICE.id }, body: { schemaVersion: 1 } });
    assert.equal(r.status, 400);
  });
});

describe('dispositivos e comandos', () => {
  test('GET /devices lista os dispositivos do usuário', async () => {
    const r = await api.call('/api/v1/devices', { token: SESSION });
    assert.equal(r.status, 200);
    assert.equal(r.data.devices[0].id, DEVICE.id);
    assert.equal(r.data.devices[0].pending, false);
  });
  test('comando sem enabled booleano ou sem commandId UUID recebe 400', async () => {
    for (const body of [{}, { enabled: 'true', commandId: '3f2c1a9e-4b5d-4c6e-8f70-123456789abc' }, { enabled: true, commandId: 'abc' }])
      assert.equal((await api.call('/api/v1/devices/esp32-mesa-01/commands', { method: 'POST', token: SESSION, body })).status, 400);
  });
});

describe('histórico de eventos', () => {
  const lastQuery = () => pool.calls.filter(c => /FROM events WHERE/.test(c.sql)).at(-1);
  test('filtra sempre pelo usuário da sessão, ignorando userId da URL', async () => {
    const r = await api.call('/api/v1/events?userId=outro', { token: SESSION });
    assert.equal(r.status, 200);
    assert.equal(lastQuery().params[0], USER.id);
    assert(!lastQuery().params.includes('outro'));
  });
  test('/breaks restringe a notificações de pausa', async () => {
    await api.call('/api/v1/breaks', { token: SESSION });
    assert.match(lastQuery().sql, /event_type='study\.break\.notification'/);
  });
  test('aplica deviceId, eventType, from e to como parâmetros (sem concatenar SQL)', async () => {
    await api.call('/api/v1/events?deviceId=esp32-mesa-01&eventType=sensor.telemetry&from=2026-01-01T00:00:00Z&to=2026-12-31T00:00:00Z', { token: SESSION });
    const { sql, params } = lastQuery();
    assert.deepEqual(params.slice(0, 5), [USER.id, 'esp32-mesa-01', 'sensor.telemetry', '2026-01-01T00:00:00.000Z', '2026-12-31T00:00:00.000Z']);
    assert(!sql.includes('esp32-mesa-01'));
  });
  test('gera nextCursor quando há mais itens que o limite', async () => {
    const r = await api.call('/api/v1/events?limit=2', { token: SESSION });
    assert.equal(r.data.events.length, 2);
    assert.deepEqual(JSON.parse(Buffer.from(r.data.nextCursor, 'base64url')), ['2026-11-27T12:00:00.000000Z', '9']);
    const all = await api.call('/api/v1/events?limit=5', { token: SESSION });
    assert.equal(all.data.nextCursor, null);
  });
  test('cursor válido vira comparação por (time,id)', async () => {
    const cursor = Buffer.from(JSON.stringify(['2026-11-27T12:00:00.000000Z', '9'])).toString('base64url');
    assert.equal((await api.call('/api/v1/events?cursor=' + cursor, { token: SESSION })).status, 200);
    assert.match(lastQuery().sql, /\(time,id\)</);
  });
  test('parâmetros inválidos recebem 400', async () => {
    const badCursor = Buffer.from(JSON.stringify(['ontem', 'abc'])).toString('base64url');
    for (const qs of ['limit=0', 'limit=101', 'limit=abc', 'from=ontem', 'to=x', 'deviceId=a%20b', 'cursor=lixo', 'cursor=' + badCursor])
      assert.equal((await api.call('/api/v1/events?' + qs, { token: SESSION })).status, 400, qs);
  });
});
