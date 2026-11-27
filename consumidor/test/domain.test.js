// Testes unitários das regras de domínio (validação do contrato v2 e visão do dispositivo).
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { validateEvent, deviceView, fail, ID, UUID } = require('../src/domain');

const DEVICE = 'esp32-mesa-01';
const pausa = { schemaVersion: 2, eventId: 'evt-1', deviceId: DEVICE, eventType: 'study.break.required',
  state: 'PAUSA_RECOMENDADA', sensorConfirmacao: 'ultrassonico+camera' };
const telemetria = { schemaVersion: 2, eventId: 'evt-2', deviceId: DEVICE, eventType: 'sensor.telemetry',
  enabled: true, version: 1, present: true, distanceCm: 48.5, studySeconds: 12 };
const estado = { schemaVersion: 2, eventId: 'evt-3', deviceId: DEVICE, eventType: 'sensor.state.reported',
  enabled: false, version: 1 };

function rejeita(event, status) {
  assert.throws(() => validateEvent(event, DEVICE), e => e.status === status);
}

describe('validateEvent — envelope do contrato v2', () => {
  test('aceita alerta de pausa válido e devolve somente campos conhecidos', () => {
    const clean = validateEvent({ ...pausa, userId: 'injetado', extra: 1 }, DEVICE);
    assert.deepEqual(clean, pausa);
  });
  test('rejeita schemaVersion diferente de 2 (contrato v1 é histórico)', () => {
    rejeita({ ...pausa, schemaVersion: 1 }, 400);
    rejeita({ ...pausa, schemaVersion: '2' }, 400);
  });
  test('rejeita eventId ausente, não textual ou com caracteres proibidos', () => {
    rejeita({ ...pausa, eventId: undefined }, 400);
    rejeita({ ...pausa, eventId: 123 }, 400);
    rejeita({ ...pausa, eventId: 'evt 1' }, 400);
    rejeita({ ...pausa, eventId: 'a'.repeat(101) }, 400);
    rejeita({ ...pausa, eventId: "evt-1'; DROP TABLE events;--" }, 400);
  });
  test('rejeita deviceId diferente da credencial autenticada', () => {
    rejeita({ ...pausa, deviceId: 'outra-mesa' }, 400);
  });
  test('rejeita corpo vazio ou nulo', () => {
    rejeita(null, 400);
    rejeita(undefined, 400);
  });
  test('rejeita com 403 tipos que só a API pode gerar', () => {
    for (const eventType of ['study.break.notification', 'sensor.command.requested', 'sensor.command.confirmed', 'qualquer'])
      rejeita({ ...pausa, eventType }, 403);
  });
});

describe('validateEvent — study.break.required', () => {
  test('exige state PAUSA_RECOMENDADA', () => rejeita({ ...pausa, state: 'OUTRO' }, 400));
  test('exige confirmação dos dois sensores (fusão)', () => {
    rejeita({ ...pausa, sensorConfirmacao: 'ultrassonico' }, 400);
    rejeita({ ...pausa, sensorConfirmacao: undefined }, 400);
  });
});

describe('validateEvent — sensor.state.reported', () => {
  test('aceita relato de estado válido', () => assert.deepEqual(validateEvent(estado, DEVICE), estado));
  test('exige enabled booleano e version inteira não negativa', () => {
    rejeita({ ...estado, enabled: 'false' }, 400);
    rejeita({ ...estado, version: -1 }, 400);
    rejeita({ ...estado, version: 1.5 }, 400);
    rejeita({ ...estado, version: undefined }, 400);
  });
});

describe('validateEvent — sensor.telemetry', () => {
  test('aceita telemetria válida, inclusive leitura inválida do sensor (-1)', () => {
    assert.deepEqual(validateEvent(telemetria, DEVICE), telemetria);
    assert.equal(validateEvent({ ...telemetria, distanceCm: -1, present: false }, DEVICE).distanceCm, -1);
  });
  test('rejeita distância fora da faixa ou não numérica', () => {
    rejeita({ ...telemetria, distanceCm: -2 }, 400);
    rejeita({ ...telemetria, distanceCm: 10001 }, 400);
    rejeita({ ...telemetria, distanceCm: Infinity }, 400);
    rejeita({ ...telemetria, distanceCm: '50' }, 400);
  });
  test('rejeita present não booleano e studySeconds inválido', () => {
    rejeita({ ...telemetria, present: 1 }, 400);
    rejeita({ ...telemetria, studySeconds: -1 }, 400);
    rejeita({ ...telemetria, studySeconds: 1.2 }, 400);
  });
});

describe('deviceView', () => {
  const row = { id: DEVICE, name: 'Mesa', desired_enabled: true, desired_version: 2,
    reported_enabled: true, reported_version: 2, last_seen_at: null, token_hash: 'segredo' };
  test('converte para camelCase e não expõe o hash do token', () => {
    const view = deviceView(row);
    assert.equal(view.desiredEnabled, true);
    assert.equal(view.reportedVersion, 2);
    assert.equal('token_hash' in view || 'tokenHash' in view, false);
  });
  test('pending=false quando desejado e relatado coincidem', () => assert.equal(deviceView(row).pending, false));
  test('pending=true quando versão ou estado divergem', () => {
    assert.equal(deviceView({ ...row, reported_version: 1 }).pending, true);
    assert.equal(deviceView({ ...row, reported_enabled: false }).pending, true);
    assert.equal(deviceView({ ...row, reported_enabled: null, reported_version: null }).pending, true);
  });
});

describe('utilitários', () => {
  test('fail lança erro com status HTTP', () => {
    assert.throws(() => fail(409, 'conflito'), e => e.status === 409 && e.message === 'conflito');
  });
  test('expressões de ID e UUID', () => {
    assert(ID.test('evt-abc.1:2_3'));
    assert(!ID.test(''));
    assert(UUID.test('3f2c1a9e-4b5d-4c6e-8f70-123456789abc'));
    assert(!UUID.test('nao-e-uuid'));
  });
});
