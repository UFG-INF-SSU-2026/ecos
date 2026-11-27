// Testes de conformidade: os exemplos publicados em contrato/ devem continuar
// compatíveis com a validação implementada na API (e o v1 deve ser recusado).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateEvent } = require('../src/domain');

const pasta = path.join(__dirname, '../../contrato');
const disponivel = fs.existsSync(pasta);
const opcoes = { skip: !disponivel && "pasta contrato/ fora do contexto (ex.: imagem Docker)" };
const lerJson = nome => JSON.parse(fs.readFileSync(path.join(pasta, nome), 'utf8'));

test('contrato/evento-v2.json é aceito pela API', opcoes, () => {
  const evento = lerJson('evento-v2.json');
  assert.deepEqual(validateEvent(evento, evento.deviceId), evento);
});

test('contrato/evento-v1.json (histórico) é recusado com 400', opcoes, () => {
  const evento = lerJson('evento-v1.json');
  assert.throws(() => validateEvent(evento, evento.deviceId), e => e.status === 400);
});

test('exemplos de POST /eventos em contrato/mobile-api.md são aceitos', opcoes, () => {
  const md = fs.readFileSync(path.join(pasta, 'mobile-api.md'), 'utf8');
  const blocos = [...md.matchAll(/```json\r?\n([\s\S]*?)```/g)].map(m => m[1].trim()).filter(b => b.startsWith('{'));
  const eventos = blocos.map(b => JSON.parse(b)).filter(j => j.schemaVersion === 2 && j.eventType && !j.payload);
  assert(eventos.length >= 3, 'esperados ao menos 3 exemplos de evento do sensor');
  for (const evento of eventos) assert.deepEqual(validateEvent(evento, evento.deviceId), evento, evento.eventType);
});

test('contrato/notificacao-websocket-v1.json mantém o vínculo com o evento de origem', opcoes, () => {
  const n = lerJson('notificacao-websocket-v1.json');
  assert.equal(n.eventType, 'study.break.notification');
  assert.equal(n.eventId, `notification-${n.sourceEventId}`);
  assert(Number.isFinite(Date.parse(n.createdAt)));
});
