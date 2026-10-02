# Roteiro de Apresentação — Marco 2

## Software para Sistemas Ubíquos

**Projeto:** Lembrete Inteligente de Lanche/Pausa para Estudo em Casa  
**Duração:** aproximadamente 10 minutos

---

## 1. Introdução

Nosso projeto é um sistema ubíquo voltado para estudantes e pessoas que estudam ou trabalham por longos períodos em casa.

A proposta é perceber a presença do usuário na mesa de estudo e, depois de determinado tempo, recomendar uma pausa.

No Marco 2, nosso objetivo foi validar uma fronteira real de comunicação entre dois componentes: um **produtor**, executado no ESP32, e um **consumidor**, desenvolvido em Node.js com Express.

O fluxo implementado é:

```text
ESP32 → HTTP/HTTPS → API Consumidora
```

O Marco 2 aproveita decisões tomadas nas atividades anteriores. Mantivemos a ideia do dispositivo próximo ao usuário, utilizando sensores e atuadores locais, mas acrescentamos uma comunicação real entre componentes.

---

## 2. Arquitetura do sistema

O **produtor** é o ESP32 simulado no Wokwi. Ele executa a lógica de detecção, controla o tempo de estudo e decide quando deve gerar um evento.

Quando a condição para pausa é atingida, o ESP32 cria um evento e faz uma requisição HTTP/HTTPS para o endpoint:

```text
POST /api/v1/eventos
```

O **consumidor** é uma API desenvolvida em Node.js com Express.

Ela recebe o JSON enviado pelo ESP32, interpreta os campos, registra os dados recebidos e responde com HTTP 200 quando o evento é recebido corretamente.

O fluxo completo é:

```text
Sensores
   ↓
ESP32 / Produtor
   ↓
Geração do evento
   ↓
HTTP/HTTPS POST
   ↓
/api/v1/eventos
   ↓
Node.js + Express / Consumidor
   ↓
Evento recebido
```

Escolhemos HTTP porque é um mecanismo simples para demonstrar a comunicação entre os dois componentes.

O produtor conhece o endpoint do consumidor e envia um evento utilizando POST.

---

## 3. Produtor — ESP32

No produtor temos os sensores e a lógica responsável por decidir quando gerar o evento.

O sensor ultrassônico é utilizado para verificar a presença do usuário através da distância.

A lógica trabalha com um **limiar**, ou seja, um valor de referência. Quando a distância medida está dentro do limite definido, consideramos que existe alguém na posição esperada.

Também utilizamos uma lógica de confirmação associada à câmera. No protótipo, essa confirmação é representada de forma simplificada no Wokwi, pois não estamos executando visão computacional real.

Quando a presença é confirmada, o sistema começa a contabilizar o tempo de estudo.

Para facilitar a demonstração, o tempo necessário para recomendar a pausa foi reduzido para aproximadamente 10 segundos.

Cada evento possui um `eventId`.

Utilizamos uma sequência incremental:

```text
evt-1
evt-2
evt-3
```

Isso permite identificar cada ocorrência individualmente e verificar no consumidor qual evento foi recebido.

---

## 4. Contrato do evento

O contrato utilizado atualmente é:

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

O campo `schemaVersion` informa a versão do contrato.

O campo `eventId` identifica unicamente o evento.

O campo `deviceId` identifica qual dispositivo produziu o evento.

O campo `eventType` informa qual acontecimento ocorreu. Nesse caso:

```text
study.break.required
```

Isso representa que uma pausa de estudo é necessária.

O campo `state` informa o estado gerado:

```text
PAUSA_RECOMENDADA
```

O campo `sensorConfirmacao` registra os mecanismos utilizados para confirmar a presença:

```text
ultrassonico+camera
```

Utilizamos:

```text
schemaVersion: 2
```

porque o contrato evoluiu em relação à primeira versão.

O versionamento permite modificar o contrato futuramente mantendo um controle sobre qual estrutura está sendo utilizada pelo produtor e pelo consumidor.

---

## 5. Consumidor — Node.js e Express

O consumidor foi desenvolvido utilizando Node.js e Express.

Ele disponibiliza a rota:

```text
POST /api/v1/eventos
```

O consumidor recebe o corpo JSON enviado pelo ESP32 e registra informações como:

```text
ID do evento
Dispositivo
Tipo do evento
Estado
Sensor de confirmação
```

Depois do processamento, responde ao produtor com HTTP 200.

Dessa forma conseguimos verificar que o evento saiu do produtor e chegou corretamente ao consumidor.

### Responsabilidade do produtor

- Perceber o ambiente.
- Ler os sensores.
- Controlar o estado local.
- Controlar o tempo de estudo.
- Decidir quando gerar o evento.
- Criar o `eventId`.
- Montar o JSON.
- Enviar o evento.

### Responsabilidade do consumidor

- Receber o evento.
- Interpretar o JSON.
- Registrar os dados recebidos.
- Produzir um efeito observável.
- Responder à requisição.

---

## 6. Funcionamento normal

Primeiro, o produtor e o consumidor são iniciados.

Quando o usuário é detectado pelo sistema, o ESP32 começa a contabilizar o tempo de estudo.

Depois que o tempo configurado é atingido, o produtor cria um novo evento.

Exemplo:

```text
=== EVENTO GERADO ===
evt-1
```

O evento é transformado em JSON e enviado através de uma requisição POST.

No consumidor podemos observar:

```text
=== EVENTO RECEBIDO ===
ID: evt-1
Dispositivo: esp32-mesa-01
Tipo: study.break.required
Estado: PAUSA_RECOMENDADA
Sensor: ultrassonico+camera
```

O mesmo `eventId` aparece nos dois componentes.

Isso permite comprovar que o evento gerado pelo ESP32 foi realmente recebido pelo consumidor.

---

## 7. Falha e recuperação

Além do funcionamento normal, o protótipo possui tratamento para condições de falha.

O sistema não deve simplesmente considerar que um evento foi entregue quando existe algum problema na comunicação.

Quando ocorre uma falha, o sistema identifica que o envio não foi realizado corretamente.

A lógica tenta recuperar a condição necessária para que a comunicação possa continuar.

Depois da recuperação, uma nova tentativa de comunicação pode ser realizada.

O objetivo do **retry** é evitar que uma falha temporária faça o sistema desistir imediatamente da comunicação.

Essa característica é importante em sistemas ubíquos porque dispositivos, sensores e redes podem apresentar indisponibilidades temporárias.

---

## 8. Estado do sistema

O estado principal da interação fica no produtor.

O ESP32 acompanha:

```text
Sensores
Presença
Tempo de estudo
Estado atual
Sequência dos eventos
```

O consumidor não precisa controlar todo o estado da interação.

Ele recebe o evento produzido pelo ESP32 e executa sua responsabilidade a partir das informações presentes no contrato.

---

## 9. Decisões arquiteturais

### Por que utilizar HTTP?

HTTP foi escolhido porque permite validar de forma simples uma fronteira real entre dois componentes.

O produtor realiza uma requisição POST e o consumidor responde à requisição.

---

### Por que utilizar `eventId`?

O `eventId` permite identificar individualmente cada evento.

Isso facilita acompanhar a mesma ocorrência entre o produtor e o consumidor.

Exemplo:

```text
Produtor: evt-1

        ↓ HTTP

Consumidor: evt-1
```

---

### Por que utilizar `schemaVersion`?

O `schemaVersion` permite controlar a evolução do contrato.

Caso novos campos sejam adicionados ou modificados futuramente, os componentes conseguem identificar qual versão da estrutura está sendo utilizada.

---

## 10. Limiar do sensor

O limiar é um valor utilizado como referência para tomar uma decisão.

No caso do sensor ultrassônico, utilizamos uma distância limite.

Podemos representar a lógica de forma simplificada como:

```text
Distância dentro do limite
        ↓
Usuário presente
```

ou:

```text
Distância fora do limite
        ↓
Usuário não detectado
```

Dessa forma, o valor retornado pelo sensor é transformado em uma informação que pode ser utilizada pela lógica do sistema.

---

## 11. Simulação da câmera

A câmera é representada de forma simplificada no protótipo.

O objetivo não é executar um algoritmo real de visão computacional no Wokwi.

A câmera representa uma segunda confirmação da presença do usuário.

Por isso, no contrato temos:

```json
"sensorConfirmacao": "ultrassonico+camera"
```

A ideia é demonstrar que a decisão pode depender de mais de uma fonte de contexto.

---

## 12. Relação com Software para Sistemas Ubíquos

Nosso sistema utiliza conceitos importantes de computação ubíqua.

Existe percepção de contexto através dos sensores.

O sistema reage à presença do usuário e ao tempo de permanência no ambiente.

O ESP32 realiza processamento próximo ao usuário e mantém parte do funcionamento local.

Também existe comunicação entre dispositivos através da rede.

Além disso, consideramos situações de falha e recuperação.

O fluxo pode ser resumido como:

```text
Ambiente
   ↓
Sensores
   ↓
Percepção de contexto
   ↓
ESP32
   ↓
Decisão
   ↓
Evento
   ↓
HTTP
   ↓
Consumidor
   ↓
Resposta
```

---

## 13. Conclusão

No Marco 2 conseguimos validar uma fronteira real do nosso sistema ubíquo.

O ESP32 atua como produtor, percebe o contexto e gera um evento identificado.

Esse evento atravessa uma comunicação HTTP/HTTPS e chega ao consumidor desenvolvido em Node.js.

O consumidor recebe o evento e produz um resultado observável.

Também utilizamos um contrato versionado, identificação única através do `eventId` e tratamento de uma condição de falha.

Com isso, validamos um fluxo essencial entre dois componentes antes de realizar integrações maiores no sistema.