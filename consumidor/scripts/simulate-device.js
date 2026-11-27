// Simulador HTTP para testar o app sem abrir o Wokwi. Não substitui o firmware.
const { randomUUID } = require('node:crypto');
const base = (process.env.API_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const deviceId = process.env.DEVICE_ID;
if (!deviceId || !process.env.DEVICE_TOKEN) throw new Error('Carregue o .env da raiz.');
let appliedVersion = -1, enabled = false, studySeconds = 0, tick = 0, alerted = false;
const pending = [];
function event(eventType, payload) {
  pending.push({ schemaVersion: 2, eventId: `sim-${randomUUID()}`, deviceId, eventType, ...payload });
}
async function api(path, body) {
  const r = await fetch(base + '/api/v1' + path, {
    method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(6000),
    headers: { Authorization: 'Bearer ' + process.env.DEVICE_TOKEN, 'X-Device-Id': deviceId, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
  return r.json();
}
let running = true;
process.once('SIGINT', () => { running = false; });
process.once('SIGTERM', () => { running = false; });
(async () => {
  console.log('Simulador local:', deviceId, 'em', base, '— Ctrl+C para encerrar.');
  while (running) {
    try {
      // Confirma e entrega pendências antes de aplicar outra configuração.
      while (pending.length) { await api('/eventos', pending[0]); pending.shift(); }
      const config = await api('/device/config');
      if (config.version !== appliedVersion) {
        appliedVersion = config.version; enabled = config.enabled; studySeconds = 0; alerted = false;
        event('sensor.state.reported', { enabled, version: appliedVersion });
        console.log('Sensor', enabled ? 'ATIVADO' : 'DESATIVADO', '| versão', appliedVersion);
      }
      // Presença por 30 segundos, ausência por 10; pausa de demonstração após 10 s.
      const present = enabled && tick % 20 < 15;
      studySeconds = present ? studySeconds + 2 : 0;
      if (!present) alerted = false;
      if (studySeconds >= 10 && !alerted) {
        event('study.break.required', { state: 'PAUSA_RECOMENDADA', sensorConfirmacao: 'ultrassonico+camera' });
        alerted = true; console.log('Pausa recomendada.');
      }
      if (tick++ % 5 === 0) event('sensor.telemetry', { enabled, version: appliedVersion,
        present, distanceCm: enabled ? (present ? 50 : 150) : -1, studySeconds });
    } catch (e) { console.error('Aguardando comunicação:', e.message); }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
