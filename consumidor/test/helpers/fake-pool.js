// Pool falso para testes unitários: responde às consultas SQL por padrão de texto,
// sem depender de PostgreSQL/TimescaleDB. Registra todas as consultas recebidas.
function fakePool(handlers = []) {
  const calls = [];
  async function query(sql, params = []) {
    calls.push({ sql, params });
    for (const [pattern, reply] of handlers) {
      if (pattern.test(sql)) {
        const result = typeof reply === 'function' ? await reply(params, sql) : reply;
        return { rows: [], rowCount: 0, ...result };
      }
    }
    return { rows: [], rowCount: 0 };
  }
  const listeners = {};
  const client = {
    query,
    on(event, fn) { (listeners[event] ||= []).push(fn); return client; },
    once(event, fn) { return client.on(event, fn); },
    emit(event, ...args) { for (const fn of listeners[event] || []) fn(...args); },
    release() {},
  };
  return { query, calls, client, connect: async () => client, end: async () => {} };
}
module.exports = { fakePool };
