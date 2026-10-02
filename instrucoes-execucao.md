# Instruções Mínimas de Execução

Este documento apresenta os passos necessários para executar e validar a integração entre o ESP32 e a API consumidora.

## 1. Consumidor

O consumidor foi desenvolvido em Node.js com Express e está hospedado no Render.

[Código do componente consumidor](consumidor/server.js)

O endpoint utilizado para receber os eventos é:

`POST https://ecos-ecmd.onrender.com/api/v1/eventos`

### Execução local

Para executar o consumidor localmente, acesse a pasta:

```bash
cd consumidor
```

Instale as dependências:

```bash
npm install
```

Inicie a aplicação:

```bash
npm start
```

O consumidor utilizará a porta definida pela variável de ambiente `PORT`. Caso ela não esteja definida, será utilizada a porta `3000`.

---
## 2. Preparação do Ambiente do Produtor

Para executar o componente produtor é necessário utilizar o Visual Studio Code com as extensões do PlatformIO e do Wokwi.

### Extensões necessárias

No Visual Studio Code, acesse a aba **Extensions** (`Ctrl + Shift + X`) e instale:

- **PlatformIO IDE**
- **Wokwi Simulator**

O PlatformIO é utilizado para compilar o código do ESP32 e gerar os arquivos necessários para a execução.

O Wokwi Simulator é utilizado para executar a simulação do ESP32 e dos componentes eletrônicos diretamente no Visual Studio Code.

### Abrindo o projeto no PlatformIO

Abra no Visual Studio Code a pasta do projeto utilizada para a simulação do ESP32.

O projeto deve possuir os arquivos de configuração do PlatformIO e do Wokwi, incluindo:

```text
platformio.ini
wokwi.toml
diagram.json
src/
└── main.cpp
```

O código disponível no repositório em:

[Código do componente produtor](produtor/sketch.ino)

corresponde à implementação utilizada pelo ESP32.

> **Atenção:** o arquivo `diagram.json` do projeto Wokwi (mantido localmente no projeto do PlatformIO, fora deste repositório) precisa ser atualizado manualmente para incluir o novo sensor de câmera. Veja a seção [7. Adicionando o sensor de câmera no Wokwi](#7-adicionando-o-sensor-de-câmera-no-wokwi) abaixo antes de compilar.

### Compilando o projeto

Após abrir o projeto no Visual Studio Code, utilize o PlatformIO para realizar a compilação.

Na barra inferior do Visual Studio Code, clique na opção **Build** do PlatformIO.

Também é possível acessar:

**PlatformIO → Project Tasks → esp32dev → General → Build**

A compilação deve ser concluída sem erros.

O PlatformIO gera os arquivos utilizados pelo simulador dentro de:

```text
.pio/build/esp32dev/
```

Entre eles:

```text
firmware.bin
firmware.elf
```

O arquivo `wokwi.toml` referencia esses arquivos para iniciar a simulação:

```toml
[wokwi]
version = 1
firmware = ".pio/build/esp32dev/firmware.bin"
elf = ".pio/build/esp32dev/firmware.elf"
```

### Executando no Wokwi

Depois de realizar o **Build** pelo PlatformIO, inicie o Wokwi Simulator no Visual Studio Code.

Com a simulação iniciada, o monitor serial deverá apresentar inicialmente:

```text
Conectando ao Wi-Fi...
Wi-Fi conectado.
```

Quando o sensor ultrassônico detectar presença a uma distância inferior a 80 cm **e** o sensor de câmera também detectar a presença de uma pessoa, será iniciada a contagem do tempo:

```text
PRESENTE | Tempo: 0s
PRESENTE | Tempo: 1s
PRESENTE | Tempo: 2s
...
```

Sempre que houver uma alteração no código do ESP32, salve o arquivo, execute novamente o **Build** do PlatformIO e reinicie a simulação do Wokwi para utilizar o novo firmware.
---

## 3. Produtor

O produtor é um ESP32 simulado no Wokwi.

[Código do componente produtor](produtor/sketch.ino)

O ESP32 utiliza a rede Wi-Fi:

`Wokwi-GUEST`

O tempo configurado para gerar o evento de pausa durante a demonstração é de 10 segundos.

Após iniciar a simulação, o sensor ultrassônico deve detectar a presença do estudante a uma distância inferior a 80 cm **e** o sensor de câmera deve detectar a presença de uma pessoa. A contagem do tempo só é iniciada quando os dois sensores confirmam a presença (fusão de sensores).

O monitor serial apresentará:

```text
Ultrassonico: PRESENCA | Camera: PRESENCA
PRESENTE | Tempo: 0s
Ultrassonico: PRESENCA | Camera: PRESENCA
PRESENTE | Tempo: 1s
...
Ultrassonico: PRESENCA | Camera: PRESENCA
PRESENTE | Tempo: 10s
```

Ao atingir o tempo configurado, o produtor gera o evento `PAUSA_RECOMENDADA`.

---

## 4. Execução Normal

Para testar a integração sem falhas, mantenha o botão conectado ao GPIO 12 liberado.

Com o estudante presente durante 10 segundos, o ESP32 gera o evento e realiza uma requisição HTTPS utilizando o método POST para o consumidor.

O resultado esperado no monitor serial do produtor é:

```text
Ultrassonico: PRESENCA | Camera: PRESENCA
PRESENTE | Tempo: 10s

PAUSA_RECOMENDADA

=== EVENTO GERADO ===
{"schemaVersion":2,"eventId":"evt-1","deviceId":"esp32-mesa-01","eventType":"study.break.required","state":"PAUSA_RECOMENDADA","sensorConfirmacao":"ultrassonico+camera"}

Enviando evento para o consumidor...
SUCESSO - HTTP 200
{"status":"recebido","eventId":"evt-1"}
```

No consumidor, o recebimento do evento pode ser verificado através do log:

```text
=== EVENTO RECEBIDO ===
ID: evt-1
Dispositivo: esp32-mesa-01
Tipo: study.break.required
Estado: PAUSA_RECOMENDADA
Confirmação de sensores: ultrassonico+camera
```

O código HTTP `200` confirma que o consumidor recebeu o evento.

---

## 5. Teste da Condição de Falha

O botão conectado ao GPIO 12 é utilizado para simular uma indisponibilidade da comunicação Wi-Fi do produtor.

Para executar o teste, mantenha o botão pressionado antes do evento ser gerado aos 10 segundos.

Quando o evento for gerado, o ESP32 identifica que a condição de falha está ativa e interrompe sua conexão Wi-Fi.

O resultado esperado é:

```text
PAUSA_RECOMENDADA

=== EVENTO GERADO ===
{"schemaVersion":2,"eventId":"evt-1","deviceId":"esp32-mesa-01","eventType":"study.break.required","state":"PAUSA_RECOMENDADA","sensorConfirmacao":"ultrassonico+camera"}

FALHA SIMULADA: comunicacao Wi-Fi indisponivel.
FALHA DETECTADA: produtor sem conexao Wi-Fi.
Evento aguardando recuperacao da comunicacao...
```

Enquanto o botão permanecer pressionado, a condição de falha continua ativa e o evento não é enviado ao consumidor.

Ao liberar o botão, o produtor considera a condição de falha encerrada e inicia a recuperação da conexão Wi-Fi.

O resultado esperado é:

```text
Falha encerrada.
Tentando recuperar a conexao Wi-Fi...
.
Wi-Fi reconectado.
Enviando evento para o consumidor...
SUCESSO - HTTP 200
{"status":"recebido","eventId":"evt-1"}
```

O evento que estava aguardando é enviado após a recuperação da comunicação, mantendo o mesmo identificador `evt-1`.

---

## 6. Contrato da Comunicação

O payload utilizado na comunicação entre o produtor e o consumidor possui uma versão identificada pelo campo `schemaVersion`.

O contrato utilizado pode ser consultado em: [Contrato do evento - versão 2](contrato/evento-v2.json) (a [versão 1](contrato/evento-v1.json) permanece no repositório como histórico)

Exemplo:

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

---

## 8. Configurações da Integração

As configurações dos componentes, comunicação, tratamento da condição de falha e principais decisões arquiteturais podem ser consultadas em: [Configurações da integração](configuracoes.md)

Os códigos utilizados estão disponíveis em:

- [Código do componente produtor](produtor/sketch.ino)
- [Código do componente consumidor](consumidor/server.js)
- [Contrato do evento](contrato/evento-v2.json)

---

## 7. Adicionando o sensor de câmera no Wokwi

O arquivo `diagram.json` do projeto Wokwi não está incluído neste repositório (ele fica no projeto local do PlatformIO, junto com `platformio.ini` e `wokwi.toml`). Para simular o novo sensor de câmera, adicione ao `diagram.json` um componente com saída digital simples — por exemplo, uma chave/botão (`wokwi-pushbutton` ou `wokwi-slide-switch`) ou um sensor PIR (`wokwi-pir-motion-sensor`), representando o sinal já processado de detecção de pessoa que uma câmera com reconhecimento embarcado forneceria.

Passos:

1. No editor do `diagram.json` (painel do Wokwi no VS Code), adicione o novo componente à lista `parts`, com um `id` (por exemplo, `"camera1"`).
2. Na lista `connections`, ligue o pino de saída do componente ao **GPIO 14** do ESP32 (pino definido em `CAMERA_PIN` no `sketch.ino`).
3. Durante a simulação:
   - Sinal em `HIGH` (chave ligada / botão pressionado / PIR ativo) = câmera detecta uma pessoa.
   - Sinal em `LOW` (chave desligada / botão solto / PIR inativo) = câmera não detecta ninguém.
4. Salve o `diagram.json`, refaça o **Build** no PlatformIO e reinicie a simulação no Wokwi.

Para o fluxo normal da demonstração, deixe o componente da câmera na posição que gera `HIGH` (pessoa detectada) sempre que o sensor ultrassônico também detectar presença.