const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { passwordHash, verifyPassword, hash, bearer, userAuth, deviceAuth } = require('../src/auth');
const { fakePool } = require('./helpers/fake-pool');

test('senhas usam salt individual e rejeitam senha incorreta', async () => {
  const first = await passwordHash('senha-de-teste-123');
  const second = await passwordHash('senha-de-teste-123');
  assert.notEqual(first, second);
  assert(await verifyPassword('senha-de-teste-123', first));
  assert.equal(await verifyPassword('senha-incorreta', first), false);
});

test('hash armazenado tem formato salt:derivado (scrypt de 64 bytes)', async () => {
  const [salt, derived] = (await passwordHash('outra-senha-segura')).split(':');
  assert.match(salt, /^[0-9a-f]{32}$/);
  assert.match(derived, /^[0-9a-f]{128}$/);
});

test('hash de token é SHA-256 determinístico e nunca igual ao token', () => {
  assert.equal(hash('abc'), hash('abc'));
  assert.equal(hash('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.notEqual(hash('abc'), 'abc');
});

describe('bearer', () => {
  const req = authorization => ({ headers: authorization === undefined ? {} : { authorization } });
  test('extrai o token do cabeçalho Authorization', () => {
    assert.equal(bearer(req('Bearer token123')), 'token123');
    assert.equal(bearer(req('bearer token123')), 'token123');
  });
  test('retorna vazio para cabeçalho ausente ou malformado', () => {
    assert.equal(bearer(req()), '');
    assert.equal(bearer(req('Basic dXNlcjpwYXNz')), '');
    assert.equal(bearer(req('Bearer ')), '');
    assert.equal(bearer(req('Bearer a b')), '');
  });
});

function run(middleware, headers) {
  return new Promise(resolve => {
    const req = { headers };
    const res = { status(code) { this.code = code; return this; }, json(body) { resolve({ req, code: this.code, body }); } };
    middleware(req, res, () => resolve({ req, next: true }));
  });
}

describe('userAuth (sessão do aplicativo)', () => {
  const user = { id: 'u1', name: 'Ana', email: 'ana@example.com' };
  test('aceita sessão válida consultando o hash do token', async () => {
    const pool = fakePool([[/FROM sessions/, params => ({ rows: params[0] === hash('tok') ? [user] : [] })]]);
    const result = await run(userAuth(pool), { authorization: 'Bearer tok' });
    assert.equal(result.next, true);
    assert.deepEqual(result.req.user, user);
    assert.equal(pool.calls[0].params[0], hash('tok'), 'o token em claro nunca vai ao banco');
  });
  test('rejeita com 401 sessão inexistente ou expirada', async () => {
    const result = await run(userAuth(fakePool()), { authorization: 'Bearer expirado' });
    assert.equal(result.code, 401);
  });
});

describe('deviceAuth (credencial do ESP32)', () => {
  test('exige X-Device-Id e token do dispositivo', async () => {
    const pool = fakePool([[/FROM devices/, p => ({ rows: p[0] === 'esp32-mesa-01' && p[1] === hash('dev') ? [{ id: p[0] }] : [] })]]);
    assert.equal((await run(deviceAuth(pool), { authorization: 'Bearer dev', 'x-device-id': 'esp32-mesa-01' })).next, true);
    assert.equal((await run(deviceAuth(pool), { authorization: 'Bearer dev', 'x-device-id': 'outra' })).code, 401);
    assert.equal((await run(deviceAuth(pool), { authorization: 'Bearer dev' })).code, 401);
    assert.equal((await run(deviceAuth(pool), { 'x-device-id': 'esp32-mesa-01' })).code, 401);
  });
});
