const { test } = require('node:test');
const assert = require('node:assert/strict');
const { passwordHash, verifyPassword } = require('../src/auth');
test('senhas usam salt individual e rejeitam senha incorreta', async () => {
  const first = await passwordHash('senha-de-teste-123');
  const second = await passwordHash('senha-de-teste-123');
  assert.notEqual(first, second);
  assert(await verifyPassword('senha-de-teste-123', first));
  assert.equal(await verifyPassword('senha-incorreta', first), false);
});
