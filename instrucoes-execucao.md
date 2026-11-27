# Reproduzir o ECOS localmente: API, app e Wokwi

Este guia executa o banco e a API no seu computador, o app no celular ou emulador e o ESP32 no Wokwi. O fluxo completo usa internet: um túnel HTTPS permite que o ESP32 simulado alcance a API local.

**Comportamento da demonstração:** somente com o sensor **ativado no aplicativo** e presença confirmada pelos dois sensores, o firmware gera uma pausa a cada **30 segundos**. Após confirmar a desativação, ele zera a contagem, desliga LEDs/buzzer e deixa de ler os sensores. Ao reativar, começa outra contagem do zero.

## 1. Preparar o ambiente e localizar a pasta correta

Instale ou tenha disponível:

| Requisito | Uso |
|---|---|
| Node.js 22.14 ou superior e npm | Configuração inicial e app Expo |
| Docker Desktop com Docker Compose v2 | API Node.js e TimescaleDB |
| `cloudflared` | Publicar a API local por HTTPS |
| Conta no Wokwi e navegador | Simular o ESP32 |
| Expo Go compatível com SDK 58, ou development build desse SDK | Executar o app Android/iOS |

Para usar simuladores locais, o iOS exige macOS com Xcode e um simulador instalado; o Android exige Android Studio com um emulador configurado. Um celular físico também serve.

No macOS, se já usa Homebrew, instale o túnel com:

```bash
brew install cloudflared
cloudflared --version
```

Para outros sistemas, siga a [instalação oficial do cloudflared](https://developers.cloudflare.com/tunnel/downloads/). Confira também:

```bash
node --version
npm --version
docker compose version
```

Abra o Docker Desktop e aguarde o mecanismo de contêineres iniciar.

No terminal, entre na pasta **`ecos` desta versão do projeto**, substituindo o caminho abaixo pelo local onde você a salvou:

```bash
cd "/caminho/para/ecos"
```

Essa pasta contém `compose.yaml`, `scripts/`, `consumidor/`, `mobile/` e `produtor/`. Os comandos de Docker e setup deste guia partem dela. Quando abrir outro terminal, entre novamente nessa pasta antes dos comandos indicados.

O que ficará em execução:

| Processo | Onde roda | Precisa continuar aberto? |
|---|---|---|
| API e banco | Docker, em segundo plano | Docker Desktop em execução |
| Túnel da API | Terminal 2 | Sim |
| Expo/Metro | Terminal 3 | Sim |
| Simulação ESP32 | Aba do Wokwi | Sim, com a simulação iniciada |

## 2. Terminal 1: configurar e iniciar a API e o banco

Na pasta `ecos`:

```bash
node scripts/setup.mjs
docker compose up --build -d --wait
```

A primeira execução baixa as imagens e instala as dependências da API. O `--wait` aguarda os serviços ficarem prontos. Confira:

```bash
docker compose ps
curl --fail http://localhost:3000/health
```

O endpoint deve responder:

```json
{"status":"ok"}
```

O setup cria estes arquivos locais, ignorados pelo Git:

| Arquivo | Conteúdo e configuração |
|---|---|
| `.env` | Senha do banco, conta inicial, `DEVICE_ID` e `DEVICE_TOKEN` |
| `mobile/.env` | Endereço da API usado pelo app |
| `produtor/secrets.h` | Wi-Fi, endereço da API, identidade/token do ESP32 e certificados |

Abra o `.env` da **raiz** e localize `USER_EMAIL` e `USER_PASSWORD`: são o e-mail e a senha do app. Para esta primeira reprodução, use os valores gerados. Se preferir ajustá-los, a senha precisa de pelo menos 12 caracteres; após salvar o arquivo, execute `docker compose up -d --wait` para carregar as alterações antes de provisionar.

Cadastre a conta e o dispositivo, depois que a API estiver pronta:

```bash
docker compose exec api node scripts/provision.js
```

A saída informa `Usuário e dispositivo configurados`. Esse comando é necessário na primeira instalação. Repeti-lo atualiza senha/token conforme o ambiente do contêiner e encerra as sessões da conta; não é necessário em cada inicialização. Se editar o `.env`, execute `docker compose up -d --wait` para recriar o serviço com as variáveis novas antes de provisionar novamente.

O setup **preserva arquivos existentes**. Se mudar `DEVICE_ID` ou `DEVICE_TOKEN` no `.env`, atualize também as constantes correspondentes em `produtor/secrets.h`. O `.env` antigo de `consumidor/` não participa desse fluxo.

A API atende na porta **3000**. O banco usa **5433** apenas na interface local do computador. Na rede interna do Docker, a API acessa o banco em `db:5432`; não altere esse endereço para `localhost` no Compose.

Para acompanhar problemas de inicialização:

```bash
docker compose logs --tail=80 api db
```

## 3. Terminal 2: criar o túnel HTTPS da API

Com a API respondendo em `/health`, execute em outro terminal:

```bash
cloudflared tunnel --url http://localhost:3000
```

Copie a URL HTTPS mostrada no terminal, semelhante a `https://SEU-TUNEL.trycloudflare.com`. O túnel temporário dispensa conta e domínio na Cloudflare. **Deixe esse terminal aberto.** [Guia oficial de Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

Em outro terminal ou no navegador, teste a URL que você recebeu, acrescentando `/health`:

```bash
curl --fail https://SEU-TUNEL.trycloudflare.com/health
```

Só prossiga quando também retornar `{"status":"ok"}`. Substitua `SEU-TUNEL` nos exemplos pela URL real; não reutilize uma URL antiga ou copiada de outra pessoa.

## 4. Usar a mesma URL no app e no ESP32

Edite `mobile/.env`:

```dotenv
EXPO_PUBLIC_API_URL=https://SEU-TUNEL.trycloudflare.com
```

Edite `produtor/secrets.h`, preservando as demais linhas:

```cpp
static const char* WIFI_SSID = "Wokwi-GUEST";
static const char* WIFI_PASSWORD = "";
static const char* API_BASE_URL = "https://SEU-TUNEL.trycloudflare.com";
static const char* DEVICE_ID = "esp32-mesa-01";
static const char* API_BEARER_TOKEN = "MESMO_DEVICE_TOKEN_DO_ENV_DA_RAIZ";
```

O `DEVICE_ID` deve coincidir com o `.env` da raiz, inclusive se você mudou o valor padrão. O setup copia o token real ao criar `secrets.h`; o texto acima é apenas um exemplo, não substitua seu token pelo texto de exemplo.

**Nos dois endereços, use HTTPS, sem `/api/v1` e sem barra final.** O código acrescenta as rotas. A variável do Expo é pública: coloque nela somente a URL, nunca senha ou token.

Mantenha o bloco **completo** `API_ROOT_CA`, desde `R"CERT(` até `)CERT";`. O modelo atual em `produtor/secrets.example.h` inclui a CA intermediária **WE1** e as raízes públicas. Se seu `secrets.h` é antigo, copie o bloco atualizado do modelo preservando sua URL, identidade e token. O setup não atualiza arquivos que já existem.

**Sempre que iniciar outro túnel:** atualize `mobile/.env` e `produtor/secrets.h`; depois reinicie o Expo e atualize/reinicie o Wokwi conforme a seção 6. A URL temporária muda entre execuções. O túnel do Expo (`expo start --tunnel`) serve para carregar o app e não publica a API da porta 3000.

## 5. Terminal 3: abrir o aplicativo

Em um novo terminal, entre em `ecos` e execute:

```bash
cd mobile
npm ci
npm start -- --clear
```

No terminal do Expo:

- Pressione `i` para abrir no simulador iOS configurado.
- Pressione `a` para abrir no emulador Android configurado.
- Ou leia o QR code com o celular usando Expo Go compatível com o SDK 58.

Se o Expo Go não aceitar o SDK deste projeto, siga o [guia de development builds do Expo](https://docs.expo.dev/develop/development-builds/create-a-build/). O terminal do Expo/Metro deve permanecer aberto. Em celular físico, use uma rede que permita acesso ao Metro; o túnel da API não transporta o bundle do Expo.

Entre com `USER_EMAIL` e `USER_PASSWORD` do `.env` da raiz. O cartão da mesa cadastrada deve aparecer. Antes do primeiro contato com o ESP32, ele pode mostrar **Aguardando sensor** ou **SEM CONEXÃO**.

O app mostra o estado da mesa e o **histórico de pausas**, com filtros por mesa e período (24 horas, 7 dias, 30 dias ou tudo). Novas pausas geram alertas com o app aberto. O banco também armazena telemetria e comandos, consultáveis pela API `/api/v1/events`; eles não aparecem como pausas na tela.

Após alterar `mobile/.env`, pare o Metro com Ctrl+C e execute novamente `npm start -- --clear`. Se o endereço da API mudar, o app pode pedir login novamente.

## 6. Abrir o sensor no Wokwi

Escolha **um** dos caminhos abaixo. O banco, a API e o app continuam rodando fora do Wokwi.

### Opção A: site do Wokwi

1. Abra um [novo projeto ESP32](https://wokwi.com/projects/new/esp32), ou faça uma cópia do [projeto de referência](https://wokwi.com/projects/478057563207155713).
2. Copie os arquivos atuais da sua pasta `produtor/`, substituindo os arquivos da cópia online conforme a tabela.
3. Confira a URL e as credenciais da **sua** API no `secrets.h` online. Copiar o projeto de referência não configura automaticamente sua instalação local.
4. Salve e clique em **▶ Start Simulation**.

| Arquivo no Wokwi | O que copiar da máquina |
|---|---|
| `sketch.ino` | Todo o conteúdo de `produtor/sketch.ino` |
| `diagram.json` | Todo o conteúdo de `produtor/diagram.json` |
| `secrets.h` | Todo o conteúdo de `produtor/secrets.h`, já configurado, incluindo certificados |
| `libraries.txt` | Conteúdo de `produtor/libraries.txt`: `ArduinoJson@7.4.2` |

Crie as abas adicionais pelo menu de arquivos do editor, se necessário. A biblioteca também pode ser adicionada pelo **Library Manager → + → ArduinoJson**; depois fixe a versão `7.4.2` no `libraries.txt`. [Bibliotecas no Wokwi](https://docs.wokwi.com/guides/libraries).

No site, você não precisa enviar `compose.yaml`, `.env`, `mobile/`, `consumidor/`, `platformio.ini` ou `wokwi.toml`. O `secrets.h` contém a credencial do dispositivo: use uma credencial de demonstração se compartilhar a simulação publicamente.

Editar o arquivo local não atualiza o projeto online. Após mudanças no firmware ou no túnel, copie novamente o arquivo alterado para o Wokwi e reinicie a simulação.

### Opção B: Wokwi no VS Code

1. Instale as extensões **PlatformIO IDE** e **Wokwi Simulator**.
2. Na paleta de comandos (`F1`), execute **Wokwi: Request a new License** e conclua a configuração da licença.
3. Abra **`produtor/` como pasta do projeto**, pois os caminhos do `wokwi.toml` partem dela.
4. Compile pelo botão **Build** do PlatformIO ou pelo terminal dessa pasta:

```bash
pio run
```

Se `pio` não estiver no PATH, use o terminal do PlatformIO ou o botão Build. O `platformio.ini` instala ArduinoJson na versão configurada.

Abra `diagram.json` e execute **Wokwi: Start Simulator**. O `wokwi.toml` aponta para `.pio/build/esp32dev/firmware.bin` e `firmware.elf`, gerados pelo build. Após editar `sketch.ino` ou `secrets.h`, compile novamente antes de reiniciar. [Guia oficial da extensão](https://docs.wokwi.com/vscode/getting-started).

### Confirmar a conexão

No monitor serial, aguarde mensagens como:

```text
Wi-Fi conectado. IP: ...
Relogio sincronizado. Consultando configuracao por HTTPS...
CONFIGURACAO APLICADA: sensor ATIVADO | versao ...
Evento persistido: HTTP 200
```

O estado também pode ser `DESATIVADO`, conforme o último comando salvo. O primeiro handshake HTTPS pode levar vários segundos. A mensagem inicial `Aguardando configuracao autenticada` sozinha ainda não confirma conexão com a API.

## 7. Reproduzir as pausas de 30 segundos e o controle pelo app

A câmera é uma **chave deslizante simulando presença já detectada**, sem captura ou processamento de imagens. Para confirmar presença, os dois sinais precisam concordar:

- Clique no HC-SR04 e ajuste a distância para **50 cm**, ou outro valor abaixo de 80 cm.
- Coloque a chave da câmera na posição ligada a **3V3**, gerando **HIGH no GPIO 14**. O LED verde acende com o sensor ativado e presença confirmada. A outra posição representa ausência.

Siga a sequência completa:

| Passo | Ação | Resultado esperado |
|---|---|---|
| 1 | No app, toque **Desativar sensor**, confirme e aguarde **Sensor desativado**. Se já estiver desativado, prossiga. | Timer zerado; LEDs e buzzer desligados. |
| 2 | Mantenha a presença simulada e aguarde pelo menos **35 segundos**. | Nenhuma nova pausa é gerada enquanto desativado. O histórico anterior permanece. |
| 3 | Toque **Ativar sensor**, confirme e aguarde **Sensor ativado**. | Começa uma contagem nova do zero. |
| 4 | Mantenha os dois sinais de presença por **30 segundos**. | LED vermelho/buzzer, `PAUSA_RECOMENDADA` no serial e uma nova pausa no app. |
| 5 | Continue na mesma posição por mais **30 segundos**. | Outra pausa é gerada automaticamente, sem reiniciar ou alternar a chave. |
| 6 | Desative pelo app e aguarde a confirmação. | A geração de novas pausas para; a contagem volta a zero. |
| 7 | Reative pelo app. | O próximo ciclo exige outros 30 segundos de presença. |

**O estado confirmado no aplicativo controla a simulação.** `Comando pendente` significa que a API salvou a solicitação, mas o ESP32 ainda precisa recebê-la e confirmar sua aplicação. As consultas ocorrem a cada 2 segundos nominais, acrescidos da latência da rede. Se o dispositivo estiver offline, aguarde a reconexão para a alteração valer no hardware.

Um dispositivo novo é cadastrado com estado desejado ativado por padrão; execuções seguintes recuperam o último estado salvo. Por isso, comece o teste acima conferindo explicitamente o estado no app.

O timer usa tempo decorrido, incluindo as chamadas HTTPS. O firmware reutiliza a conexão TLS, mas requisições síncronas e a velocidade da simulação podem atrasar o disparo até a próxima amostra. No teste de reprodução, dois disparos consecutivos ficaram separados por cerca de **30,05 segundos** no relógio da simulação.

Afastar o ultrassônico para 80 cm ou mais, ou mudar a chave para ausência, também zera a contagem. Alertas gerados antes de uma desativação podem ser entregues depois se estavam aguardando envio; isso não representa uma nova pausa gerada com o sensor desativado.

A telemetria é enviada a cada 15 segundos. Desativado, o dispositivo mantém contato com a API, mas informa `enabled=false`, `present=false`, `distanceCm=-1` e tempo zero. Alertas móveis funcionam com o app aberto; push em segundo plano não foi implementado.

Para testar recuperação, mantenha pressionado **Falha Wi-Fi** e envie um comando pelo app: ele fica pendente. Solte o botão e aguarde a confirmação. Reiniciar o Wokwi recupera o último estado desejado salvo na API. Não execute duas simulações com o mesmo `DEVICE_ID` ao mesmo tempo.

## 8. Encerrar e reproduzir novamente em outro momento

1. Pare a simulação no Wokwi.
2. Pare o Expo e o `cloudflared` com Ctrl+C nos respectivos terminais.
3. Na pasta `ecos`, pare os serviços:

```bash
docker compose stop
```

Para voltar, abra o Docker Desktop e execute na pasta `ecos`:

```bash
docker compose up --build -d --wait
curl --fail http://localhost:3000/health
```

Depois repita as seções **3 a 7**: novo túnel, mesma URL no app e no firmware, Expo e Wokwi. Preserve os arquivos `.env` e `secrets.h`; o setup não precisa ser repetido, e a conta/dispositivo já estão cadastrados.

O histórico fica no volume Docker `ecos_timescale-data`. `docker compose stop` e `docker compose down` preservam esse volume. **`docker compose down -v` apaga os dados locais**, portanto não use esse comando para encerrar uma demonstração. Alterar `POSTGRES_PASSWORD` no `.env` não modifica a senha de um banco já inicializado; mantenha os valores coerentes com o volume existente.

## 9. Resolver os erros mais comuns

| Sintoma | Verificação e correção |
|---|---|
| Docker não inicia os serviços | Abra o Docker Desktop. Use `docker compose ps` e `docker compose logs --tail=80 api db`. |
| `/health` local falha | Confira a API na porta 3000 antes de testar app ou Wokwi. |
| `/health` público falha | Confirme o terminal do `cloudflared` aberto, o encaminhamento para `http://localhost:3000` e a URL recém-gerada. |
| App mostra `JSON Parse error: Unexpected character: <` | Recebeu HTML onde esperava JSON. Teste `/health`; se a API mudou, reconstrua o serviço com o comando abaixo. A rota de histórico do app é `/api/v1/breaks`. |
| Wokwi não compila: `API_BASE_URL` ou `API_ROOT_CA` não declarado | Copie o `secrets.h` completo atual para a aba online e mantenha `#include "secrets.h"` no sketch. |
| Wokwi mostra somente a mensagem inicial | Use o `sketch.ino` atual: o serial informa as etapas de Wi-Fi, NTP e HTTPS. Confira `Wokwi-GUEST`, senha vazia e botão Falha Wi-Fi solto. |
| TLS `-29312` / EOF | A conexão encerrou durante o handshake. Confira o túnel atual, copie o bundle completo de certificados e os limites HTTPS da versão atual; veja abaixo. |
| HTTP 401 no dispositivo | Confira `DEVICE_ID` e `API_BEARER_TOKEN` contra o `.env` e o cadastro provisionado. |
| App não entra ou encerra a sessão | Use e-mail/senha do `.env` provisionado. Provisionar de novo revoga sessões; faça login outra vez. |
| App sem dispositivo | Confira conta usada no login e execute o provisionamento na primeira instalação. Se há erro de rede, resolva-o antes de concluir que a conta está vazia. |
| Sensor ativado, mas não há pausa | Confirme distância abaixo de 80 cm, chave da câmera em HIGH e 30 segundos de presença contínua. |
| Comando continua pendente | Mantenha o Wokwi rodando, Wi-Fi disponível e túnel ativo. Verifique o serial e aguarde a confirmação. |
| Mudança em `.env` do app não aparece | Pare o Metro e reinicie com `npm start -- --clear` em `mobile/`. |

### API atualizada no código, mas antiga no Docker

O Compose copia os arquivos ao criar a imagem. Após editar o backend, apenas `docker compose restart api` não inclui o código novo. Na pasta `ecos`, use:

```bash
docker compose up --build -d --wait api
```

Depois atualize a tela do app. Não é necessário apagar o banco nem provisionar a conta novamente.

### TLS com Wokwi e Cloudflare

A configuração validada usa o bundle atual de `API_ROOT_CA`, incluindo **WE1**, e:

```cpp
client.setHandshakeTimeout(30); // segundos
http.setConnectTimeout(10000);  // milissegundos
http.setTimeout(10000);         // milissegundos
```

Esses valores já estão no firmware. Copie as versões atuais de **ambos** os arquivos, `sketch.ino` e `secrets.h`, e reinicie o simulador. O erro EOF não comprova falha de certificado; aumentar apenas o limite do cliente também não impede o servidor de encerrar uma negociação lenta.

A validação de certificado, validade e hostname permanece ativa. WE1 foi obtida por uma conexão TLS validada e expira em **20/02/2029**. Atualize o bundle quando necessário ou se o host mudar de CA. Não substitua essa configuração por `setInsecure()`.

## 10. Alternativa rápida: testar o app sem Wokwi

Com a API e o banco iniciados, é possível testar o app usando o simulador HTTP em Node. Para esse teste isolado, o app no simulador iOS pode usar `http://localhost:3000`; no emulador Android, `http://10.0.2.2:3000`. O celular físico exige um endereço acessível, como o mesmo túnel HTTPS do fluxo principal. Reinicie o Metro após mudar a URL.

Em um terminal separado, partindo de `ecos`:

```bash
cd consumidor
npm ci
npm run simulate:device
```

Ele usa as credenciais do `.env` da raiz e a API local em `http://localhost:3000`. Confirma comandos do app e simula presença/ausência. **Esse script tem seu próprio cenário de teste, com pausa após 10 segundos; a demonstração de pausas recorrentes de 30 segundos descrita neste guia é a do firmware Wokwi.** Pare com Ctrl+C. Não execute esse script e o Wokwi simultaneamente com o mesmo `DEVICE_ID`.

## 11. Alternativa: API sem contêiner

O banco continua no Docker:

```bash
docker compose stop api
docker compose up -d db
cd consumidor
npm ci
npm run db:migrate
npm run db:provision
npm run start:local
```

Os scripts `*:local` e `db:*` usam o `.env` da raiz. `npm start` usa as variáveis já fornecidas pelo ambiente e é o comando indicado em hospedagem.

Opcionalmente, configure `TLS_KEY_PATH` e `TLS_CERT_PATH` com os caminhos dos arquivos para servir HTTPS diretamente. Defina ambos ou nenhum. Celular/Wokwi precisam confiar na CA usada: um certificado autoassinado local não é aceito automaticamente pelo Expo Go. Prefira HTTPS com certificado público para o fluxo completo.

## 12. Cadastrar outro usuário/dispositivo

Na raiz do projeto, depois que a API estiver disponível:

```bash
docker compose exec \
  -e USER_NAME="Outro estudante" \
  -e USER_EMAIL=outro@example.com \
  -e USER_PASSWORD="UMA_SENHA_NOVA_COM_12_OU_MAIS_CARACTERES" \
  -e DEVICE_ID=esp32-mesa-02 \
  -e DEVICE_NAME="Outra mesa" \
  -e DEVICE_TOKEN="UM_TOKEN_ALEATORIO_NOVO_DE_PELO_MENOS_32_CARACTERES" \
  api node scripts/provision.js
```

Gere o token com `openssl rand -hex 32` e configure a segunda simulação com essa identidade e credencial. O servidor deriva `userId` do cadastro do dispositivo, nunca do corpo enviado. Cada conta só consulta seu próprio histórico e só controla seus próprios dispositivos. Para adicionar outra mesa à mesma conta, use o mesmo e-mail e senha no provisionamento e um novo `DEVICE_ID`/token.

## 13. Testes e verificações

Na raiz, execute a suíte completa com **TimescaleDB real e temporário**, separado do banco da aplicação:

```bash
docker compose -f compose.test.yaml up --build --abort-on-container-exit --exit-code-from test
```

A suíte cobre login/expiração/logout, autorização por usuário, validação de contratos, deduplicação concorrente, comando pendente e confirmação, reativação, relatos fora de ordem, isolamento do WebSocket, filtros/paginação e recuperação por nova instância da API. O banco de testes usa `tmpfs` e não toca no volume da aplicação.

Verificações adicionais:

```bash
cd consumidor
npm test
cd ../mobile
npm test
npm run typecheck
npm run export:check
cd ../produtor
pio run
```

`npm test` em `consumidor/` executa os testes unitários (domínio, autenticação, rotas HTTP, WebSocket e contratos) e pula a integração se `TEST_DATABASE_URL` não estiver definida. Em `mobile/`, `npm test` verifica o cliente da API do app. Os mesmos testes rodam no GitHub Actions a cada push; a lista de casos e os resultados estão em [docs/testes.md](docs/testes.md). Para integração, use preferencialmente o Compose acima; o teste rejeita banco cujo nome não termina em `_test` e limpa somente esse banco de teste.

## 14. Hospedagem

- Hospede a API (`consumidor`, `npm ci`, `node scripts/migrate.js`, `npm start`) atrás de HTTPS/WSS e forneça `DATABASE_URL` de uma instância **com TimescaleDB habilitado**. PostgreSQL comum não satisfaz a migração temporal.
- Configure `NODE_ENV=production`. Com TLS terminado em um único proxy confiável, configure `TRUST_PROXY=1`, mantenha a porta Node acessível apenas pelo proxy e deixe os caminhos TLS vazios. Sem proxy, use TLS diretamente e `TRUST_PROXY=0`.
- O host precisa permitir conexões WebSocket em `/api/v1/stream`. Não é mais necessário hospedar o consumidor WebSocket antigo.
- Execute o provisionamento com as credenciais do ambiente. Depois de provisionar, a API usa os hashes no banco; as variáveis de senha e token em texto só são necessárias ao script administrativo.
- Se o banco exigir TLS, use a cadeia de certificados fornecida pelo serviço; não desative a verificação TLS. Faça backup do PostgreSQL/TimescaleDB e mantenha o volume persistente.
- Atualize os endereços públicos no app e no firmware. A API confirma eventos após COMMIT no banco, independentemente de o celular estar conectado.

## Referências técnicas

- [Expo SDK e compatibilidade de React/React Native](https://docs.expo.dev/versions/latest/).
- [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/).
- [Instalação do TimescaleDB](https://www.tigerdata.com/docs/get-started/choose-your-path/install-timescaledb).
- [Hypertables e índices temporais](https://www.tigerdata.com/docs/reference/timescaledb/hypertables).
- Contratos, segurança e limites específicos desta implementação: [configuracoes.md](configuracoes.md) e [contrato/mobile-api.md](contrato/mobile-api.md).
