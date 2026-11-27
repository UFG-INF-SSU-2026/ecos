const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const http = require('node:http');
const WebSocket = require('ws');
const database = process.env.TEST_DATABASE_URL;
test('Fluxo integrado com TimescaleDB real', { skip: !database, timeout: 60000 }, async t => {
  assert.match(new URL(database).pathname, /_test$/, 'Use exclusivamente um banco cujo nome termine em _test.');
  process.env.DATABASE_URL = database; process.env.NODE_ENV = 'test'; process.env.TRUST_PROXY = '0';
  const { Pool } = require('pg');
  const { pool } = require('../src/db');
  const { migrate } = require('../scripts/migrate');
  const { passwordHash, hash } = require('../src/auth');
  const { createApp } = require('../src/app');
  const { attachRealtime } = require('../src/realtime');
  await migrate(); await migrate();
  await pool.query('TRUNCATE events,event_receipts,commands,sessions,devices,users CASCADE');
  const alice = randomUUID(), bob = randomUUID();
  const sensorToken = 'sensor-test-token-012345678901234567890123456789';
  const password = 'correct-test-password', stored = await passwordHash(password);
  for (const [id, name] of [[alice, 'Alice'], [bob, 'Bob']])
    await pool.query('INSERT INTO users VALUES($1,$2,$3,$4)', [id, name, `${name.toLowerCase()}@example.com`, stored]);
  await pool.query('INSERT INTO devices(id,user_id,name,token_hash) VALUES($1,$2,$3,$4)', ['esp32-mesa-01', alice, 'Mesa Alice', hash(sensorToken)]);
  const server = http.createServer(createApp(pool));
  const realtime = await attachRealtime(server, pool);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await realtime.close(); await new Promise(r => server.close(r)); await pool.end(); });
  async function api(path, token, body, extra = {}) {
    const response = await fetch(`${base}/api/v1${path}`, { method: body === undefined ? 'GET' : 'POST',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json', ...extra },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: response.status === 204 ? null : await response.json() };
  }
  const login = email => api('/auth/login', null, { email, password });
  const aliceLogin = await login('alice@example.com'), bobLogin = await login('bob@example.com');
  const a = aliceLogin.data.token, b = bobLogin.data.token;
  const sensorHeaders = { 'X-Device-Id': 'esp32-mesa-01' };
  const event = { schemaVersion: 2, eventId: 'integration-break', deviceId: 'esp32-mesa-01',
    eventType: 'study.break.required', state: 'PAUSA_RECOMENDADA', sensorConfirmacao: 'ultrassonico+camera' };
  const send = body => api('/eventos', sensorToken, body, sensorHeaders);
  await t.test('migrações criam hypertable e são idempotentes', async () => {
    const { rows } = await pool.query("SELECT hypertable_name FROM timescaledb_information.hypertables WHERE hypertable_name='events'");
    assert.equal(rows.length, 1);
  });
  await t.test('login, identidade e separação de credenciais', async () => {
    assert.equal(aliceLogin.status, 200); assert.equal(bobLogin.status, 200);
    assert.equal((await api('/devices')).status, 401);
    assert.equal((await api('/devices', sensorToken)).status, 401);
    assert.equal((await api('/eventos', a, event, sensorHeaders)).status, 401);
    assert.equal((await api('/auth/login', null, { email: 'alice@example.com', password: 'wrong' })).status, 401);
    assert.equal((await api('/me', a)).data.user.id, alice);
  });
  await t.test('dispositivos e comandos são isolados por proprietário', async () => {
    assert.equal((await api('/devices', a)).data.devices.length, 1);
    assert.equal((await api('/devices', b)).data.devices.length, 0);
    assert.equal((await api('/devices/esp32-mesa-01/commands', b, { enabled: false, commandId: randomUUID() })).status, 404);
  });
  await t.test('sensor não pode falsificar identidade, tipo ou contrato', async () => {
    assert.equal((await send({ ...event, deviceId: 'outro-sensor' })).status, 400);
    assert.equal((await send({ ...event, eventType: 'sensor.command.requested' })).status, 403);
    assert.equal((await send({ ...event, schemaVersion: 1 })).status, 400);
    assert.equal((await send({ ...event, eventId: 123 })).status, 400);
    assert.equal((await api('/eventos', sensorToken, event, { 'X-Device-Id': 'outra-mesa' })).status, 401);
  });
  await t.test('evento e notificação persistem; userId recebido é ignorado', async () => {
    assert.equal((await send({ ...event, userId: bob })).status, 200);
    const history = (await api('/events', a)).data.events;
    assert.equal(history.length, 2); assert(history.every(e => e.userId === alice));
    assert(history.some(e => e.eventType === 'study.break.notification'));
    assert.equal((await api('/events?userId=' + alice, b)).data.events.length, 0);
  });
  await t.test('duplicação concorrente é segura e conteúdo alterado retorna 409', async () => {
    const responses = await Promise.all(Array.from({ length: 8 }, () => send({ ...event, eventId: 'new-concurrent-event' })));
    assert(responses.every(r => r.status === 200));
    assert.equal(responses.filter(r => !r.data.duplicate).length, 1);
    assert.equal(responses.filter(r => r.data.duplicate).length, 7);
    assert.equal((await api('/events', a)).data.events.length, 4);
    assert.equal((await send({ ...event, eventType: 'sensor.state.reported', enabled: true, version: 0 })).status, 409);
  });
  await t.test('desativação pendente, repetição idempotente e confirmação do sensor', async () => {
    const disable = { enabled: false, commandId: randomUUID() };
    const first = await api('/devices/esp32-mesa-01/commands', a, disable);
    assert.equal(first.status, 202); assert.equal(first.data.version, 1);
    const repeat = await api('/devices/esp32-mesa-01/commands', a, disable);
    assert.equal(repeat.data.duplicate, true); assert.equal(repeat.data.version, 1);
    assert.equal((await api('/devices/esp32-mesa-01/commands', a, { ...disable, enabled: true })).status, 409);
    const config = await api('/device/config', sensorToken, undefined, sensorHeaders);
    assert.deepEqual(config.data, { deviceId: event.deviceId, enabled: false, version: 1 });
    assert.equal((await api('/devices', a)).data.devices[0].pending, true);
    assert.equal((await send({ ...event, eventId: 'ack-disable', eventType: 'sensor.state.reported', enabled: false, version: 1 })).status, 200);
    const device = (await api('/devices', a)).data.devices[0];
    assert.equal(device.reportedEnabled, false); assert.equal(device.pending, false);
    const c = await pool.query('SELECT confirmed_at FROM commands WHERE id=$1', [disable.commandId]);
    assert(c.rows[0].confirmed_at);
    assert((await api('/events', a)).data.events.some(e => e.eventType === 'sensor.command.confirmed'));
  });
  await t.test('reativação e relatos antigos preservam estado mais novo', async () => {
    assert.equal((await api('/devices/esp32-mesa-01/commands', a, { enabled: true, commandId: randomUUID() })).status, 202);
    assert.equal((await send({ ...event, eventId: 'ack-enable', eventType: 'sensor.state.reported', enabled: true, version: 2 })).status, 200);
    assert.equal((await send({ ...event, eventId: 'late-disable', eventType: 'sensor.state.reported', enabled: false, version: 1 })).status, 200);
    const device = (await api('/devices', a)).data.devices[0];
    assert.equal(device.reportedEnabled, true); assert.equal(device.reportedVersion, 2); assert.equal(device.pending, false);
  });
  await t.test('versões/estados inválidos não alteram histórico; telemetria válida persiste', async () => {
    const before = (await api('/events', a)).data.events.length;
    assert.equal((await send({ ...event, eventId: 'future-ack', eventType: 'sensor.state.reported', enabled: true, version: 999 })).status, 409);
    assert.equal((await send({ ...event, eventId: 'wrong-ack', eventType: 'sensor.state.reported', enabled: false, version: 2 })).status, 409);
    assert.equal((await api('/events', a)).data.events.length, before);
    assert.equal((await send({ ...event, eventId: 'telemetry', eventType: 'sensor.telemetry',
      enabled: true, version: 2, present: true, distanceCm: 48.5, studySeconds: 8 })).status, 200);
  });
  await t.test('filtros e paginação conservam precisão de microssegundos', async () => {
    let cursor = null; const ids = [];
    do {
      const page = await api('/events?limit=2' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''), a);
      assert.equal(page.status, 200); ids.push(...page.data.events.map(e => e.id)); cursor = page.data.nextCursor;
    } while (cursor);
    const { rows: [count] } = await pool.query('SELECT count(*) FROM events WHERE user_id=$1', [alice]);
    assert.equal(ids.length, Number(count.count)); assert.equal(new Set(ids).size, ids.length);
    assert.equal((await api('/events?eventType=sensor.telemetry', a)).data.events.length, 1);
    assert.equal((await api('/events?deviceId=outra-mesa', a)).data.events.length, 0);
    assert.equal((await api('/events?from=2099-01-01T00%3A00%3A00Z', a)).data.events.length, 0);
    assert.equal((await api('/events?limit=9999', a)).status, 400);
    assert.equal((await api('/events?cursor=garbage', a)).status, 400);
    assert.equal((await api('/events?from=invalid', a)).status, 400);
  });
  function connect(token) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(base.replace('http:', 'ws:') + '/api/v1/stream');
      ws.once('open', () => ws.send(JSON.stringify({ type: 'auth', token })));
      ws.once('error', reject);
      ws.once('message', data => {
        try { assert.equal(JSON.parse(data).type, 'ready'); resolve(ws); } catch (e) { reject(e); }
      });
    });
  }
  await t.test('WebSocket só avisa o dono após COMMIT', async () => {
    const wsAlice = await connect(a), wsBob = await connect(b);
    let bobMessages = 0; wsBob.on('message', () => bobMessages++);
    const received = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Evento WebSocket não recebido.')), 4000);
      wsAlice.once('message', raw => { clearTimeout(timer); resolve(JSON.parse(raw)); });
    });
    await send({ ...event, eventId: 'realtime-break' });
    assert.deepEqual(await received, { type: 'events.changed', deviceId: event.deviceId });
    assert.equal(bobMessages, 0);
    assert((await api('/events?eventType=study.break.notification', a)).data.events.some(e => e.eventId === 'notification-realtime-break'));
    wsAlice.terminate(); wsBob.terminate();
  });
  await t.test('WebSocket rejeita credencial de sensor', async () => {
    const ws = new WebSocket(base.replace('http:', 'ws:') + '/api/v1/stream');
    ws.once('open', () => ws.send(JSON.stringify({ type: 'auth', token: sensorToken })));
    assert.equal(await new Promise(resolve => ws.once('close', resolve)), 1008);
  });
  await t.test('nova instância recupera histórico, comandos e deduplicação', async () => {
    const freshPool = new Pool({ connectionString: database });
    const other = http.createServer(createApp(freshPool));
    await new Promise(r => other.listen(0, '127.0.0.1', r));
    try {
      const url = `http://127.0.0.1:${other.address().port}/api/v1`;
      const duplicate = await fetch(url + '/eventos', { method: 'POST', headers: {
        Authorization: 'Bearer ' + sensorToken, 'X-Device-Id': event.deviceId, 'Content-Type': 'application/json' }, body: JSON.stringify(event) });
      assert.equal((await duplicate.json()).duplicate, true);
      const history = await fetch(url + '/events', { headers: { Authorization: 'Bearer ' + a } });
      assert((await history.json()).events.length > 4);
      const d = await fetch(url + '/devices', { headers: { Authorization: 'Bearer ' + a } });
      assert.equal((await d.json()).devices[0].reportedVersion, 2);
    } finally { await new Promise(r => other.close(r)); await freshPool.end(); }
  });
  await t.test('logout e expiração revogam acesso REST', async () => {
    assert.equal((await api('/auth/logout', a, {})).status, 204);
    assert.equal((await api('/events', a)).status, 401);
    await pool.query("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1", [bob]);
    assert.equal((await api('/devices', b)).status, 401);
  });
});
