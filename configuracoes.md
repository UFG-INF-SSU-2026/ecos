# Arquitetura e segurança — aplicativo móvel e persistência temporal

A API em `consumidor/` recebe eventos do ESP32, grava em TimescaleDB e atende o aplicativo React Native em `mobile/`. O aplicativo substitui o antigo consumidor WebSocket como interface final. O processo antigo em `websocket-consumer/` é histórico e não integra este fluxo.

## Identidades e autorização

- `users`: identificação UUID, nome, e-mail único e senha derivada com scrypt e salt aleatório.
- `devices`: identificador, proprietário e SHA-256 do token individual. O token tem de ser aleatório e longo; não é compartilhado com o app.
- `sessions`: SHA-256 de tokens opacos aleatórios de 256 bits e expiração em 7 dias. O app guarda o token em Expo SecureStore; o banco não guarda seu valor em texto.
- Login tem limite de 20 tentativas por IP em 15 minutos por instância. Consultas REST e comandos exigem sessão válida. A propriedade é verificada no servidor em todas as operações.
- `POST /eventos` e `GET /device/config` usam Bearer do dispositivo e `X-Device-Id`. O `userId` de um evento é obtido da associação do dispositivo no banco. Campos extras enviados pelo sensor são descartados na normalização.
- O WebSocket usa autenticação na primeira mensagem, com prazo de 5 segundos, para funcionar no cliente nativo sem colocar token na URL. O servidor só envia avisos ao proprietário autenticado. Sessões são revalidadas a cada 15 segundos, incluindo expiração/revogação; REST verifica a cada requisição.
- Provisionamento é administrativo por CLI, sem cadastro público. Recadastramento troca senha/token e revoga sessões; o script não transfere dispositivos entre contas.

## Persistência e consultas

`events` é uma hypertable TimescaleDB particionada por `time` (TIMESTAMPTZ UTC), com índices por usuário/tempo e usuário/dispositivo/tempo. Todos os eventos de domínio aceitos, notificações geradas, solicitações de comando e confirmações são gravados ali. O horário do histórico é o de ingestão no servidor, não o horário de captura do ESP32. Requests de leitura, login e logs de transporte não são eventos de domínio.

`event_receipts` usa uma chave única `(device_id,event_id)` independente do tempo; a verificação do hash normalizado detecta reutilização conflitante (409). As transações travam a linha do dispositivo para serializar comandos e relatos concorrentes. Gravação do evento, notificação derivada, recibo idempotente e atualização de estado são atômicos. A resposta 200 só ocorre após COMMIT; banco indisponível retorna erro, permitindo reenvio com o mesmo ID.

A API pagina por `(time,id)` com cursor que conserva microssegundos, sem offsets que mudem com novas inserções. Todas as consultas usam parâmetros SQL e filtram pelo usuário da sessão. Filtros incluem dispositivo, tipo, início/fim UTC e limite até 100 registros. A UI converte horários para o fuso do aparelho.

PostgreSQL `LISTEN/NOTIFY` dispara apenas depois do COMMIT. O aviso WebSocket contém `events.changed` e `deviceId`; o app consulta os registros duráveis por REST. O aviso não é uma fila persistente: a recuperação vem do histórico, da sincronização na reconexão e da consulta periódica. Múltiplas instâncias da API recebem NOTIFY do mesmo banco. Não configure o listener através de um pooler em modo transaction pooling.

## Caminho de retorno ao ESP32

1. O app gera um UUID `commandId` e envia `{enabled,commandId}`. O servidor verifica o proprietário e grava o comando, uma nova versão do estado desejado e `sensor.command.requested` na mesma transação.
2. O sensor consulta a configuração a cada 2 segundos nominais por HTTPS. Essa opção funciona no Wokwi sem servidor de entrada no ESP32.
3. Ao aplicar uma versão nova, o firmware zera timer/alerta. Ao desativar, desliga LEDs/buzzer e suspende leituras físicas, mantendo a comunicação. Na inicialização, aguarda uma configuração autenticada antes de medir.
4. O ESP32 envia `sensor.state.reported` com a versão/estado aplicados. O backend só aceita combinações correspondentes aos comandos existentes (ou versão inicial 0/ativado). A confirmação registra `sensor.command.confirmed` uma única vez e atualiza o estado reportado sem regredir por relatos antigos.
5. A interface compara estado desejado e reportado. Envio HTTP 202 significa **persistido/pendente**, não aplicado. Um dispositivo offline mantém o último estado conhecido e a pendência visível.

A configuração representa **o estado desejado mais recente**. Se várias solicitações chegarem enquanto o sensor estiver offline, ele pode aplicar diretamente a última; as anteriores continuam auditadas como solicitadas, sem falsa confirmação. Uma confirmação atrasada de uma versão antiga não apaga a pendência de uma versão nova.

## Transporte e limites

- Firmware usa NTP e `WiFiClientSecure::setCACert`, validando certificado, validade e hostname. O bundle inclui a intermediária WE1 como âncora confiável para reduzir o custo da cadeia no Wokwi/Cloudflare; ela expira em 20/02/2029 e precisa ser atualizada se o host mudar de CA. Handshake tem limite de 30 segundos; conexão e resposta HTTP, 10 segundos cada.
- App aceita HTTP apenas em desenvolvimento. Em produção, API e WebSocket exigem HTTPS/WSS. `TRUST_PROXY=1` só se aplica a um proxy confiável que protege a porta interna.
- JSON e frames WebSocket são limitados a 4 KiB. Clientes lentos são desconectados para refazer sincronização REST. A API evita colocar credenciais em respostas, logs e URLs.
- O Docker Compose padrão é de desenvolvimento: HTTP na porta 3000 e banco ligado somente à interface local. Use HTTPS público para integrar Wokwi/celular.
- Leituras temporais são amostradas a cada 15 segundos, com backpressure; não se tenta registrar cada pulso do sensor. Pendências do firmware ficam em RAM e podem se perder se ele reiniciar antes de conseguir publicar. Armazenamento offline persistente no hardware não está implementado.
- Alertas móveis são exibidos com o aplicativo aberto. Push em segundo plano não está implementado; o histórico continua disponível no próximo acesso.
- Sessões expiradas são removidas no login. Recibos idempotentes e eventos não têm retenção automática nesta versão; planeje retenção e backups para uma implantação longa.

Veja [instrucoes-execucao.md](instrucoes-execucao.md) para execução local, provisionamento, Wokwi, hospedagem e testes.
