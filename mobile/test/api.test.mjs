// Testes da camada de comunicação do app (src/api.ts), executados com o Node
// (node --experimental-transform-types), sem emulador e sem dependências do Expo.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

let counter = 0;
async function load(apiUrl, dev = true) {
  process.env.EXPO_PUBLIC_API_URL = apiUrl;
  globalThis.__DEV__ = dev;
  // A URL é lida na importação; a query string força um módulo novo a cada cenário.
  return import(`../src/api.ts?cenario=${++counter}`);
}

let calls, nextResponse, originalFetch;
beforeEach(() => {
  calls = [];
  nextResponse = { status: 200, body: { ok: true } };
  originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    const { status, body } = nextResponse;
    return { status, ok: status >= 200 && status < 300, json: async () => body };
  };
});
afterEach(() => { globalThis.fetch = originalFetch; });

describe('configuração da URL da API', () => {
  test('remove barras finais de EXPO_PUBLIC_API_URL', async () => {
    const api = await load('https://ecos.example.com///');
    assert.equal(api.API_URL, 'https://ecos.example.com');
  });
  test('URL ausente gera erro orientando a configurar mobile/.env', async () => {
    const api = await load('');
    await assert.rejects(api.request('/me'), /EXPO_PUBLIC_API_URL/);
    assert.equal(calls.length, 0);
  });
  test('HTTP sem TLS só é aceito em desenvolvimento', async () => {
    const dev = await load('http://localhost:3000', true);
    await dev.request('/me');
    assert.equal(calls.length, 1);
    const prod = await load('http://localhost:3000', false);
    await assert.rejects(prod.request('/me'), /HTTPS/);
    assert.equal(calls.length, 1);
  });
  test('streamUrl converte https→wss e http→ws', async () => {
    assert.equal((await load('https://ecos.example.com')).streamUrl(), 'wss://ecos.example.com/api/v1/stream');
    assert.equal((await load('http://localhost:3000')).streamUrl(), 'ws://localhost:3000/api/v1/stream');
  });
});

describe('request', () => {
  test('GET autenticado envia Bearer e prefixo /api/v1', async () => {
    const api = await load('https://ecos.example.com');
    nextResponse = { status: 200, body: { devices: [] } };
    assert.deepEqual(await api.request('/devices', 'tok'), { devices: [] });
    assert.equal(calls[0].url, 'https://ecos.example.com/api/v1/devices');
    assert.equal(calls[0].init.method, 'GET');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
    assert.equal(calls[0].init.body, undefined);
  });
  test('POST serializa o corpo em JSON e não envia Authorization sem token', async () => {
    const api = await load('https://ecos.example.com');
    await api.request('/auth/login', undefined, { email: 'a@b.c', password: 'x' });
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.body, JSON.stringify({ email: 'a@b.c', password: 'x' }));
    assert.equal('Authorization' in calls[0].init.headers, false);
  });
  test('HTTP 204 resolve sem tentar ler JSON', async () => {
    const api = await load('https://ecos.example.com');
    nextResponse = { status: 204, body: undefined };
    assert.equal(await api.request('/auth/logout', 'tok', {}), undefined);
  });
  test('erro da API vira ApiError com status e mensagem do servidor', async () => {
    const api = await load('https://ecos.example.com');
    nextResponse = { status: 401, body: { error: 'Sessão inválida ou expirada. Entre novamente.' } };
    const error = await api.request('/me', 'velho').catch(e => e);
    assert(error instanceof api.ApiError);
    assert.equal(error.status, 401);
    assert.equal(error.message, 'Sessão inválida ou expirada. Entre novamente.');
  });
  test('erro sem corpo usa mensagem genérica', async () => {
    const api = await load('https://ecos.example.com');
    nextResponse = { status: 500, body: {} };
    await assert.rejects(api.request('/devices', 'tok'), /Falha na comunicação/);
  });
  test('requisição possui sinal de cancelamento (timeout de 12 s)', async () => {
    const api = await load('https://ecos.example.com');
    await api.request('/me', 'tok');
    assert(calls[0].init.signal instanceof AbortSignal);
  });
});
