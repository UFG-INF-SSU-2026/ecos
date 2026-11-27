const { transaction, appendEvent } = require('./db');
const { hash } = require('./auth');
const ID = /^[A-Za-z0-9._:-]{1,100}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function fail(status, message) { const e = new Error(message); e.status = status; throw e; }
function validateEvent(event, deviceId) {
  if (!event || event.schemaVersion !== 2 || typeof event.eventId !== 'string' || !ID.test(event.eventId) || event.deviceId !== deviceId)
    fail(400, 'Contrato, eventId ou deviceId inválido.');
  const allowed = ['study.break.required', 'sensor.telemetry', 'sensor.state.reported'];
  if (!allowed.includes(event.eventType)) fail(403, 'Tipo de evento não autorizado.');
  if (event.eventType === 'study.break.required') {
    if (event.state !== 'PAUSA_RECOMENDADA' || event.sensorConfirmacao !== 'ultrassonico+camera')
      fail(400, 'Alerta inválido.');
    return { schemaVersion: 2, eventId: event.eventId, deviceId, eventType: event.eventType,
      state: event.state, sensorConfirmacao: event.sensorConfirmacao };
  }
  if (typeof event.enabled !== 'boolean' || !Number.isInteger(event.version) || event.version < 0)
    fail(400, 'enabled e version são obrigatórios.');
  const clean = { schemaVersion: 2, eventId: event.eventId, deviceId, eventType: event.eventType,
    enabled: event.enabled, version: event.version };
  if (event.eventType === 'sensor.telemetry') {
    if (typeof event.present !== 'boolean' || !Number.isFinite(event.distanceCm) || event.distanceCm < -1 ||
        event.distanceCm > 10000 || !Number.isInteger(event.studySeconds) || event.studySeconds < 0)
      fail(400, 'Telemetria inválida.');
    Object.assign(clean, { present: event.present, distanceCm: event.distanceCm, studySeconds: event.studySeconds });
  }
  return clean;
}
async function ingest(pool, device, raw) {
  const event = validateEvent(raw, device.id);
  const digest = hash(JSON.stringify(event));
  return transaction(pool, async client => {
    // Serializa comandos e relatos do mesmo sensor; duplicatas concorrentes são seguras.
    const { rows: [current] } = await client.query('SELECT * FROM devices WHERE id=$1 FOR UPDATE', [device.id]);
    const prior = await client.query('SELECT payload_hash FROM event_receipts WHERE device_id=$1 AND event_id=$2',
      [device.id, event.eventId]);
    if (prior.rows[0]) {
      if (prior.rows[0].payload_hash !== digest) fail(409, 'eventId já usado com outro conteúdo.');
      return { status: 'recebido', eventId: event.eventId, duplicate: true };
    }
    if (event.eventType !== 'study.break.required') {
      let expected = true;
      if (event.version > 0) {
        const command = await client.query('SELECT enabled FROM commands WHERE device_id=$1 AND version=$2',
          [device.id, event.version]);
        if (!command.rows[0]) fail(409, 'Versão de comando desconhecida.');
        expected = command.rows[0].enabled;
      }
      if (event.enabled !== expected) fail(409, 'Estado incompatível com a versão do comando.');
      if (event.eventType === 'sensor.state.reported' && event.version >= (current.reported_version ?? -1)) {
        await client.query('UPDATE devices SET reported_enabled=$2, reported_version=$3 WHERE id=$1',
          [device.id, event.enabled, event.version]);
        const confirmed = await client.query(`UPDATE commands SET confirmed_at=clock_timestamp()
          WHERE device_id=$1 AND version=$2 AND confirmed_at IS NULL RETURNING id`, [device.id, event.version]);
        if (confirmed.rows[0]) await appendEvent(client, { userId: device.user_id, deviceId: device.id,
          eventId: `ack-${confirmed.rows[0].id}`, eventType: 'sensor.command.confirmed',
          payload: { commandId: confirmed.rows[0].id, enabled: event.enabled, version: event.version } });
      }
    }
    await client.query('INSERT INTO event_receipts VALUES($1,$2,$3)', [device.id, event.eventId, digest]);
    await client.query('UPDATE devices SET last_seen_at=clock_timestamp() WHERE id=$1', [device.id]);
    await appendEvent(client, { userId: device.user_id, deviceId: device.id,
      eventId: event.eventId, eventType: event.eventType, payload: event });
    if (event.eventType === 'study.break.required') await appendEvent(client, {
      userId: device.user_id, deviceId: device.id, eventId: `notification-${event.eventId}`,
      eventType: 'study.break.notification', payload: { sourceEventId: event.eventId,
        message: 'Hora da pausa para o lanche!' } });
    return { status: 'recebido', eventId: event.eventId };
  });
}
async function setEnabled(pool, userId, deviceId, body) {
  if (!body || typeof body.enabled !== 'boolean' || !UUID.test(body.commandId || ''))
    fail(400, 'Envie enabled booleano e commandId UUID (reutilize-o ao repetir a requisição).');
  return transaction(pool, async client => {
    const device = await client.query('SELECT * FROM devices WHERE id=$1 AND user_id=$2 FOR UPDATE', [deviceId, userId]);
    if (!device.rows[0]) fail(404, 'Dispositivo não encontrado.');
    const previous = await client.query('SELECT * FROM commands WHERE id=$1', [body.commandId]);
    if (previous.rows[0]) {
      const c = previous.rows[0];
      if (c.device_id !== deviceId || c.user_id !== userId || c.enabled !== body.enabled)
        fail(409, 'commandId já usado com outro conteúdo.');
      return { commandId: c.id, version: c.version, enabled: c.enabled, duplicate: true };
    }
    const version = device.rows[0].desired_version + 1;
    await client.query('UPDATE devices SET desired_enabled=$2, desired_version=$3 WHERE id=$1',
      [deviceId, body.enabled, version]);
    await client.query('INSERT INTO commands(id,user_id,device_id,enabled,version) VALUES($1,$2,$3,$4,$5)',
      [body.commandId, userId, deviceId, body.enabled, version]);
    await appendEvent(client, { userId, deviceId, eventId: body.commandId, eventType: 'sensor.command.requested',
      payload: { commandId: body.commandId, enabled: body.enabled, version } });
    return { commandId: body.commandId, enabled: body.enabled, version };
  });
}
function deviceView(row) {
  return { id: row.id, name: row.name, desiredEnabled: row.desired_enabled,
    desiredVersion: row.desired_version, reportedEnabled: row.reported_enabled,
    reportedVersion: row.reported_version, lastSeenAt: row.last_seen_at,
    pending: row.desired_version !== row.reported_version || row.desired_enabled !== row.reported_enabled };
}
module.exports = { ingest, setEnabled, fail, deviceView, UUID, ID };
