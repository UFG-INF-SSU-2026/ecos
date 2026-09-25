# Configurações da Integração

## Arquitetura

A integração é composta por um produtor, um meio de comunicação e um consumidor.

- **Produtor:** ESP32 simulado no Wokwi.
- **Comunicação:** requisição HTTPS utilizando o método POST e payload JSON.
- **Consumidor:** API desenvolvida em Node.js com Express e hospedada no Render.

Fluxo da integração:

**ESP32 → HTTPS POST → API Node.js/Express**

Os códigos dos componentes estão disponíveis em:

- [Código do componente produtor](produtor/sketch.ino)
- [Código do componente consumidor](consumidor/server.js)

## Produtor

O componente produtor é o ESP32, responsável por detectar a presença do estudante por meio de dois sensores (fusão de sensores) e controlar o tempo de estudo.

O ESP32 utiliza os seguintes componentes:

- Sensor ultrassônico:
  - TRIG: GPIO 4
  - ECHO: GPIO 2
- Sensor de câmera (segundo sensor de presença): GPIO 14
- Botão para simulação de falha: GPIO 12
- LED verde: GPIO 25
- LED vermelho: GPIO 27
- Buzzer: GPIO 19

A presença do estudante só é confirmada quando o sensor ultrassônico (distância < 80 cm) e o sensor de câmera (detecção de pessoa) concordam simultaneamente.

A rede utilizada na simulação do Wokwi é:

`Wokwi-GUEST`

O tempo configurado para gerar o evento de pausa é de 10 segundos.

Quando o estudante permanece presente durante esse período, o produtor gera um evento com o estado `PAUSA_RECOMENDADA`.

## Comunicação

A comunicação entre o produtor e o consumidor ocorre através de HTTPS.

O ESP32 realiza uma requisição utilizando o método:

`POST`

Endpoint utilizado:

`https://ecos-ecmd.onrender.com/api/v1/eventos`

O conteúdo da requisição é enviado no formato JSON utilizando:

`Content-Type: application/json`

O contrato utilizado na comunicação está disponível em: [Contrato do evento - versão 2](contrato/evento-v2.json) (a [versão 1](contrato/evento-v1.json) permanece no repositório como histórico, antes da inclusão do segundo sensor).

A versão atual do contrato é identificada pelo campo:

`schemaVersion: 2`

## Consumidor

O componente consumidor é uma API desenvolvida utilizando Node.js e Express. [Código do componente consumidor](consumidor/server.js)

A API recebe os eventos através da rota:

`POST /api/v1/eventos`

Ao receber um evento, o consumidor registra no log:

- identificador do evento;
- identificador do dispositivo;
- tipo do evento;
- estado recebido.

Após o recebimento, o consumidor responde ao produtor com HTTP 200 e confirma o identificador do evento recebido.

Exemplo do evento recebido:

```json
{
  "schemaVersion": 2,
  "eventId": "evt-1",
  "deviceId": "esp32-mesa-01",
  "eventType": "study.break.required",
  "state": "PAUSA_RECOMENDADA",
  "sensorConfirmacao": "ultrassonico+camera"
}
```

## Decisões Arquiteturais

Para o Marco 2 foi escolhida uma integração direta entre dois componentes independentes: o ESP32 atua como produtor dos eventos e a API Node.js/Express atua como consumidor.

### Comunicação via HTTPS

Foi utilizado o modelo de comunicação baseado em requisição e resposta através de HTTPS, utilizando o método POST.

Essa abordagem foi escolhida por permitir uma integração simples entre o ESP32 e a API, além de possibilitar que o produtor receba uma resposta do consumidor confirmando o recebimento do evento através do código HTTP.

O fluxo adotado é:

**ESP32 → HTTPS POST → API Node.js/Express → HTTP 200**

### Separação entre produtor e consumidor

O produtor e o consumidor possuem responsabilidades diferentes.

O **produtor**, implementado no ESP32, é responsável por detectar a presença do estudante, controlar o tempo de estudo, gerar o evento de pausa e iniciar sua transmissão.

O **consumidor**, implementado em Node.js com Express, é responsável por receber o evento enviado pelo ESP32, processar seu conteúdo e registrar as informações recebidas.

Essa separação permite que os dois componentes sejam executados de forma independente, mantendo a comunicação definida pelo contrato do evento.

- [Código do componente produtor](produtor/sketch.ino)
- [Código do componente consumidor](consumidor/server.js)

### Contrato versionado

A comunicação utiliza um payload JSON com estrutura definida e versão identificada pelo campo `schemaVersion`.

A utilização de um contrato permite que produtor e consumidor conheçam previamente a estrutura dos dados utilizados na integração.

A versão utilizada no Marco 2, após a inclusão do sensor de câmera, é:

`schemaVersion: 2`

O contrato pode ser consultado em: [Contrato do evento - versão 2](contrato/evento-v2.json)

### Fusão de sensores (câmera + ultrassônico)

Foi adicionado um segundo sensor ao produtor: um sensor de câmera, responsável por detectar a presença de uma pessoa de forma independente do sensor ultrassônico.

A decisão de projeto foi confirmar a presença do estudante apenas quando os dois sensores concordam (lógica E), em vez de considerar isoladamente a leitura de um único sensor.

Essa fusão reduz a chance de falsos positivos: uma leitura isolada e ruidosa do sensor ultrassônico não é suficiente para disparar o timer de estudo caso o sensor de câmera não confirme a presença de uma pessoa.

O evento gerado passou a registrar essa confirmação no campo `sensorConfirmacao`, o que motivou a evolução do contrato para a versão 2.

- [Código do componente produtor](produtor/sketch.ino)

### Identificação dos eventos

Cada evento possui o campo `eventId`, utilizado para identificar o evento durante a comunicação entre os componentes.

No cenário implementado, o produtor gera identificadores sequenciais, como:

`evt-1`

Essa identificação também é retornada pelo consumidor na resposta, permitindo relacionar o evento enviado com a confirmação recebida.

### Tratamento da indisponibilidade de comunicação

Foi considerada a possibilidade de o produtor perder sua conectividade antes de conseguir entregar um evento ao consumidor.

Quando essa condição ocorre, o evento já gerado permanece aguardando enquanto a comunicação estiver indisponível. Após a recuperação da conexão Wi-Fi, o produtor realiza o envio do mesmo evento.

Essa decisão evita descartar imediatamente um evento apenas porque a comunicação estava indisponível no momento em que ele foi gerado.

A condição de falha é reproduzida no protótipo através do botão conectado ao GPIO 12.