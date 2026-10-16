# Arquitetura, segurança e autorização

## Fluxo integrado

```text
ESP32 (esp32-mesa-01)
  ── HTTPS POST /api/v1/eventos ──▶ API Node.js
                                      (HTTP consumer + WS producer)
  ◀── HTTP 200 após confirmação ───    │
                                      └── WSS /api/v1/publicacoes ──▶
                                            Consumidor WebSocket
                                            (websocket-consumer-01)
```

O ESP32 original é o primeiro produtor. A API Node.js, que no fluxo anterior era apenas consumidora, valida e processa a solicitação e então atua como um segundo produtor. Ela envia uma notificação para um novo consumidor através de WebSocket sobre TLS. O endpoint HTTP só confirma o evento depois de receber a confirmação do consumidor WebSocket.

## Canais e contratos

### ESP32 → API

- Transporte: HTTPS, com validação do certificado do servidor por `WiFiClientSecure::setCACert`.
- Rota: `POST /api/v1/eventos`.
- Identidade: `Authorization: Bearer <ESP32_TOKEN>` e `X-Device-Id: esp32-mesa-01`.
- Autorização: a credencial do ESP32 pode publicar apenas `study.break.required`. A API confere também que `deviceId` e header correspondem e que o corpo segue o contrato versão 2.
- Contrato: [contrato/evento-v2.json](contrato/evento-v2.json).

### API → consumidor WebSocket

- Transporte: WSS (WebSocket sobre TLS).
- Rota: `/api/v1/publicacoes`.
- Identidade: o produtor envia seu token `WS_PRODUCER_TOKEN` no handshake WebSocket. A credencial identifica `consumidor-http-01`.
- Autorização: o consumidor só aceita o tipo `study.break.notification` com os campos permitidos e `deviceId` associado à credencial.
- Confirmação: o consumidor devolve `accepted` ou `duplicate` com seu ID `websocket-consumer-01`; a API valida a confirmação antes de responder ao ESP32.
- Contrato: [contrato/notificacao-websocket-v1.json](contrato/notificacao-websocket-v1.json).

## Credenciais e segredos

`ESP32_TOKEN` e `WS_PRODUCER_TOKEN` são credenciais independentes. As variáveis no backend devem conter exatamente o token configurado no respectivo produtor. O firmware lê seu segredo de `secrets.h`, criado localmente a partir de [produtor/secrets.example.h](produtor/secrets.example.h). Não grave tokens em `sketch.ino`, `.env.example` nem em diagramas compartilhados. `.env`, `secrets.h`, certificados e chaves locais são ignorados pelo Git.

O servidor compara tokens em tempo constante, limita tamanho do JSON e do frame WebSocket e valida os campos e os tipos de eventos antes de encaminhá-los. O ESP32 repete o mesmo `eventId` nas tentativas HTTP; os serviços reconhecem IDs repetidos e evitam publicar a notificação duas vezes no mesmo período de execução.

## TLS em desenvolvimento e hospedagem

Para execução local, gere um certificado autoassinado com SAN para `localhost` e configure `TLS_KEY_PATH`, `TLS_CERT_PATH` e `WS_CA_CERT` em `.env`. O cliente WebSocket e o `curl` confiam explicitamente no certificado local. Esse certificado é somente para desenvolvimento.

Na hospedagem com proxy TLS, use HTTPS e WSS públicos. O Render termina TLS no proxy e encaminha HTTP ao processo Node.js; configure `NODE_ENV=production`, mantenha os caminhos dos arquivos TLS vazios e deixe a API validar `X-Forwarded-Proto` através do `trust proxy`. O ESP32 valida as CAs raiz configuradas em `API_ROOT_CA`; o exemplo inclui ISRG Root X1 e GTS Root R1, que cobrem cadeias dos certificados gerenciados do Render. Confirme a CA raiz efetiva do domínio publicado.

## Hardware do produtor

| Componente | GPIO ESP32 |
|---|---:|
| HC-SR04 TRIG | 4 |
| HC-SR04 ECHO | 2 |
| Sinal de presença da câmera simulada | 14 |
| Botão de falha Wi-Fi | 12 |
| LED verde | 25 |
| LED vermelho | 27 |
| Buzzer | 19 |

O sinal no GPIO 14 representa a saída digital já processada por um sistema de câmera: `HIGH` detecta uma pessoa e `LOW` indica ausência. A contagem começa quando a distância fica abaixo de 80 cm e os dois sinais confirmam presença. O limiar de demonstração continua em 10 segundos.

## Arquivos

- Produtor ESP32: [produtor/sketch.ino](produtor/sketch.ino).
- Consumidor HTTP e produtor WebSocket: [consumidor/server.js](consumidor/server.js).
- Novo consumidor WebSocket: [consumidor/websocket-consumer/server.js](consumidor/websocket-consumer/server.js).
- Configuração local: [consumidor/.env.example](consumidor/.env.example).
- Instruções de execução e implantação: [instrucoes-execucao.md](instrucoes-execucao.md).
