# API móvel e dispositivo

Base: `/api/v1`. HTTPS/WSS em produção; JSON UTF-8. Respostas de erro: `{ "error": "mensagem" }`.

## Autenticação do app

`POST /auth/login` recebe `{ "email": "estudante@example.com", "password": "..." }` e retorna `{ "token": "...", "expiresAt": "ISO-8601", "user": { "id": "UUID", "name": "...", "email": "..." } }`.

Nas demais rotas do app: `Authorization: Bearer <token-da-sessão>`.

| Método/rota | Resultado |
|---|---|
| GET `/me` | `{user}` da sessão |
| POST `/auth/logout` | Revoga a sessão; HTTP 204 |
| GET `/devices` | `{devices:[{id,name,desiredEnabled,desiredVersion,reportedEnabled,reportedVersion,lastSeenAt,pending}]}` |
| POST `/devices/:id/commands` | Corpo `{enabled:boolean,commandId:UUID}`; HTTP 202 com `{commandId,enabled,version}` |
| GET `/events` | `{events:[...],nextCursor:string\|null}` |

`reportedEnabled`/`reportedVersion` são `null` antes do primeiro relato. `pending=true` até o estado desejado corresponder ao informado. `lastSeenAt` vem do último contato autenticado do dispositivo.

`commandId` é idempotente e deve ser reutilizado nas tentativas do mesmo comando. Uma repetição retorna a mesma versão e `duplicate:true`. Reutilização com outro conteúdo retorna 409. O HTTP 202 não comprova que o hardware aplicou o comando.

Filtros de `/events`: `deviceId`, `eventType`, `from`, `to` (datas ISO-8601), `limit` (1–100, padrão 50), `cursor` (opaco, retornado pela página anterior). Ordem: ingestão decrescente. Nunca envie `userId` para escolher o dono: ele é sempre o da sessão.

Um item de histórico:

```json
{
  "id": "42",
  "time": "2026-11-27T15:00:00.000Z",
  "userId": "b3d289a6-9ac2-4dd8-b45c-a761c322bd32",
  "deviceId": "esp32-mesa-01",
  "eventId": "evt-boot-3",
  "eventType": "sensor.state.reported",
  "payload": {"schemaVersion":2,"eventId":"evt-boot-3","deviceId":"esp32-mesa-01","eventType":"sensor.state.reported","enabled":false,"version":1}
}
```

## WebSocket do app

Conecte a `wss://HOST/api/v1/stream` e envie, em até 5 segundos:

```json
{"type":"auth","token":"TOKEN_DA_SESSAO"}
```

Servidor responde `{"type":"ready"}`. Após alterações persistidas pertencentes ao usuário, envia `{"type":"events.changed","deviceId":"esp32-mesa-01"}`. Nesse momento consulte `/devices` e `/events`. Ao reconectar, consulte novamente mesmo se nenhum aviso chegar. Fechamento 1008 indica sessão inválida; faça login novamente. O aviso não substitui o histórico persistente.

## Autenticação do ESP32

Todas as rotas do dispositivo exigem `Authorization: Bearer <DEVICE_TOKEN>` e `X-Device-Id: <DEVICE_ID>`. O proprietário vem do banco.

`GET /device/config` responde:

```json
{"deviceId":"esp32-mesa-01","enabled":false,"version":1}
```

`POST /eventos` aceita o alerta original v2 e os dois tipos adicionais:

```json
{"schemaVersion":2,"eventId":"evt-boot-1","deviceId":"esp32-mesa-01","eventType":"study.break.required","state":"PAUSA_RECOMENDADA","sensorConfirmacao":"ultrassonico+camera"}
```

```json
{"schemaVersion":2,"eventId":"evt-boot-2","deviceId":"esp32-mesa-01","eventType":"sensor.state.reported","enabled":false,"version":1}
```

```json
{"schemaVersion":2,"eventId":"evt-boot-3","deviceId":"esp32-mesa-01","eventType":"sensor.telemetry","enabled":true,"version":2,"present":true,"distanceCm":50.0,"studySeconds":8}
```

Resposta 200 após persistência: `{"status":"recebido","eventId":"evt-boot-1"}`. Repetição idêntica inclui `duplicate:true`; conteúdo conflitante com o mesmo ID retorna 409. O antigo campo `downstream` não é mais retornado: não há dependência de um consumidor online para aceitar o evento.

Tipos armazenados: `study.break.required`, `study.break.notification`, `sensor.telemetry`, `sensor.state.reported`, `sensor.command.requested`, `sensor.command.confirmed`. Notificações e eventos de comando são gerados pela API; o sensor não tem autorização para publicá-los diretamente.

Códigos principais: 400 contrato/filtro inválido; 401 credencial inválida/expirada; 403 tipo proibido; 404 dispositivo não pertencente ao usuário; 409 conflito de ID/estado/versão; 413 corpo excede 4 KiB; 426 HTTPS obrigatório; 429 limite de login; 500 falha de persistência/serviço (repetir com o mesmo ID).
