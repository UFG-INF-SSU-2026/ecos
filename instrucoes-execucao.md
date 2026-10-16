# Execução e validação da integração segura

## O que foi acrescentado e por quê

O fluxo agora contém duas integrações encadeadas:

```text
ESP32 produtor
  └─ HTTPS + token → API Node.js consumidora/produtora
                         └─ WSS + token → consumidor WebSocket
```

1. O ESP32 envia `study.break.required` à API por HTTPS. A API identifica o ESP32 pelo token, exige que o `X-Device-Id` e o `deviceId` do evento correspondam a `esp32-mesa-01` e só autoriza o tipo `study.break.required`.
2. Depois de validar o evento, a API, que antes apenas consumia eventos, passa a atuar também como produtora. Ela publica `study.break.notification` por WebSocket seguro (WSS) para um novo consumidor.
3. O consumidor WebSocket autentica a API, associa o token ao dispositivo `consumidor-http-01`, aceita apenas `study.break.notification` e devolve uma confirmação identificada como `websocket-consumer-01`.

O certificado TLS do servidor é validado nos dois canais; o firmware não usa `setInsecure()`. Os tokens são independentes, ficam em variáveis de ambiente no servidor e em `secrets.h` local no ESP32, que não deve ser versionado. A API faz comparação de tokens em tempo constante, valida o contrato e mantém deduplicação em memória para novas tentativas com o mesmo `eventId`.

O contrato original HTTP continua em [evento-v2.json](contrato/evento-v2.json). O evento publicado pelo novo canal está em [notificacao-websocket-v1.json](contrato/notificacao-websocket-v1.json).

## Requisitos

- Node.js 20.6 ou superior e npm.
- OpenSSL para gerar tokens e certificados locais.
- Para o ESP32: VS Code com PlatformIO e Wokwi, além do projeto de simulação com `platformio.ini`, `wokwi.toml` e `diagram.json`. Esses arquivos do simulador não estão neste repositório.

## Executar localmente os dois serviços

Os comandos abaixo usam certificados de desenvolvimento para que a conexão local também seja HTTPS/WSS. Execute-os a partir da pasta do consumidor:

```bash
cd "/Users/christopher/Desktop/UFG/Atividade Wokwi/ecos/consumidor"
npm install
cp .env.example .env
mkdir -p .certs
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout .certs/local-key.pem \
  -out .certs/local-cert.pem \
  -days 365 -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
openssl rand -hex 32
openssl rand -hex 32
```

Copie os dois tokens gerados para `.env`: o primeiro em `ESP32_TOKEN` e o segundo em `WS_PRODUCER_TOKEN`. Use tokens diferentes. No desenvolvimento local, mantenha `WS_CONSUMER_URL=wss://localhost:3001/api/v1/publicacoes`, `WS_CA_CERT=.certs/local-cert.pem` e os caminhos TLS do exemplo. O arquivo `.env` e a chave privada ficam ignorados pelo Git.

Abra dois terminais, ambos na pasta `consumidor`. Inicie primeiro o consumidor WebSocket:

```bash
npm run start:ws:local
```

Depois inicie a API HTTP:

```bash
npm run start:local
```

No modo local, a API atende em `https://localhost:3000` e o novo consumidor em `wss://localhost:3001/api/v1/publicacoes`. O certificado é autoassinado e serve somente para desenvolvimento; o `curl` e o cliente WebSocket confiam nele explicitamente através de `--cacert` e `WS_CA_CERT`.

## Testar o fluxo completo local

Em um terceiro terminal, carregue as configurações locais:

```bash
cd "/Users/christopher/Desktop/UFG/Atividade Wokwi/ecos/consumidor"
set -a
source .env
set +a
```

Envie um evento HTTP válido. A API só retorna sucesso depois que o consumidor WebSocket confirma a publicação:

```bash
curl --cacert .certs/local-cert.pem -i \
  -X POST https://localhost:3000/api/v1/eventos \
  -H "Authorization: Bearer $ESP32_TOKEN" \
  -H "X-Device-Id: esp32-mesa-01" \
  -H "Content-Type: application/json" \
  -d '{"schemaVersion":2,"eventId":"evt-demo-001","deviceId":"esp32-mesa-01","eventType":"study.break.required","state":"PAUSA_RECOMENDADA","sensorConfirmacao":"ultrassonico+camera"}'
```

Resposta esperada da API:

```json
{"status":"recebido","eventId":"evt-demo-001","downstream":"accepted","downstreamEventId":"notification-evt-demo-001"}
```

No terminal do consumidor WebSocket, procure `PUBLICAÇÃO WEBSOCKET RECEBIDA`; no terminal da API, procure `EVENTO RECEBIDO` e a confirmação `accepted`.

Teste também os controles de segurança:

- Troque o token no header `Authorization`: a API deve responder `401`.
- Mantenha o token válido e troque `X-Device-Id` ou o `deviceId` do JSON: a API deve rejeitar a identidade (`403`).
- Mude `eventType` para um tipo não autorizado: a API deve responder `403`.
- Repita o comando válido com o mesmo `eventId`: a API responde sucesso com `duplicate: true` e não cria uma segunda notificação.

## Configurar a simulação do ESP32

O código do produtor está em [produtor/sketch.ino](produtor/sketch.ino). Copie-o para `src/main.cpp` no projeto PlatformIO local. Copie [produtor/secrets.example.h](produtor/secrets.example.h) como `src/secrets.h` e configure:

- `API_URL`: URL HTTPS pública da API, terminando em `/api/v1/eventos`.
- `API_BEARER_TOKEN`: o mesmo valor definido como `ESP32_TOKEN` no serviço da API.
- `API_ROOT_CA`: certificado(s) raiz confiável(is) para validar o certificado TLS do host da API. O exemplo inclui ISRG Root X1 e GTS Root R1, duas raízes usadas pelos certificados gerenciados do Render; confirme a cadeia do host escolhido e atualize o bundle se necessário.

O firmware sincroniza o relógio por NTP para validar datas do certificado TLS. No Wokwi, conecte o HC-SR04 a TRIG GPIO 4 e ECHO GPIO 2, o sinal digital da câmera simulada ao GPIO 14, botão de falha ao GPIO 12, LEDs aos GPIOs 25 e 27 e buzzer ao GPIO 19. A entrada de câmera representa uma detecção já processada: `HIGH` indica pessoa presente.

Faça o Build no PlatformIO e inicie a simulação. Com distância menor que 80 cm, GPIO 14 em `HIGH` e botão de falha solto, após 10 segundos o ESP32 envia o evento. O monitor serial deve mostrar `SUCESSO - HTTP 200`; nos logs dos dois serviços deve aparecer a recepção e a confirmação WebSocket. O `eventId` gerado inclui um identificador de boot e permanece igual nas tentativas HTTP do mesmo evento.

Para simular ausência, aumente a distância ou coloque a entrada da câmera em `LOW`; o timer deixa de avançar. Para testar reconexão, pressione o botão GPIO 12 antes do evento. Ao soltá-lo, o ESP32 tenta recuperar o Wi-Fi e reenviar o evento.

O Wokwi não consegue acessar `localhost` do computador como se fosse a própria máquina. Para o teste com ESP32, publique os dois serviços com URLs HTTPS/WSS acessíveis e configure essas URLs no Render e em `secrets.h`. Os comandos `curl` acima fazem o teste integrado local dos serviços sem depender do Wokwi.

## Implantar em serviços com proxy TLS (ex.: Render)

Publique dois serviços a partir deste repositório. Em ambos, use `consumidor` como diretório raiz/build e configure `NODE_ENV=production`. O Render termina HTTPS/WSS no proxy e encaminha HTTP ao processo Node; a API confia no `X-Forwarded-Proto` pelo `trust proxy` configurado e rejeita requisições sem origem HTTPS. Em produção deixe `TLS_KEY_PATH` e `TLS_CERT_PATH` vazios e use os URLs públicos `https://` e `wss://`. Consulte a documentação oficial do Render sobre [Web Services](https://render.com/docs/web-services), [WebSockets](https://render.com/docs/websocket) e [TLS gerenciado](https://render.com/docs/tls).

**Serviço da API (HTTP consumer e novo WS producer)**

- Comando de início: `npm start`.
- Variáveis: `ESP32_TOKEN`, `WS_PRODUCER_TOKEN`, `WS_PRODUCER_ID=consumidor-http-01` e `WS_CONSUMER_URL=wss://<host-do-consumidor-ws>/api/v1/publicacoes`.
- Use o mesmo `WS_PRODUCER_TOKEN` no consumidor WebSocket.

**Serviço consumidor WebSocket**

- Comando de início: `npm run start:ws`.
- Variáveis: `WS_PRODUCER_TOKEN` e `WS_PRODUCER_ID=consumidor-http-01`.
- Use o endereço WSS público desse serviço como `WS_CONSUMER_URL` na API.

Configure `ESP32_TOKEN` no ambiente da API e copie o mesmo valor para `API_BEARER_TOKEN` do firmware. Não compartilhe ou versione tokens reais. Configure `API_URL` como o endereço HTTPS público da API. Reinicie os dois serviços depois de alterar suas variáveis.

Se o plano suspender serviços sem tráfego, o primeiro acesso pode esperar a retomada do consumidor WebSocket. O produtor aguarda até 60 segundos pela confirmação; o firmware dá até 65 segundos à resposta HTTPS e repete a mesma publicação em caso de falha.

## Limites desta demonstração

- A deduplicação mantém os últimos 1.000 IDs somente em memória; reiniciar o processo limpa esse histórico. Uma implantação durável precisaria de armazenamento persistente/outbox.
- Os tokens são credenciais compartilhadas por componente, rotacionáveis, mas não são certificados individuais de cliente. O token do ESP32 está compilado no firmware e pode ser extraído de um dispositivo físico; para produção, prefira autenticação mútua com certificado por dispositivo ou um elemento seguro.
- `npm test` continua sem suíte automatizada; os passos acima são validações manuais ponta a ponta.
