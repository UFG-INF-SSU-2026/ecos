# Atividade em Grupo 02 — Processamento e distribuição de responsabilidades

**Cenário escolhido:** Lembrete Inteligente de Lanche para Estudo em Casa

**Integrantes:** Ana Liz Bomfim Gomes, Christopher Star Correa de Oliveira, Gustavo Alves Marçal, Mateus Silva de Sousa

---

## Parte 1 - Eventos do sistema

### 1. Tipos de evento
Foram definidos dois tipos de evento relevantes para as decisões do sistema:
- `LeituraDistancia`: Leitura periódica contínua da distância bruta medida pelo sensor ultrassônico em direção à cadeira de estudo.
- `MudancaEstadoPresenca`: Evento discreto gerado após a filtragem e classificação da distância, indicando quando o estudante transita entre os estados `PRESENTE` e `AUSENTE`.

---

### 2. Contrato dos eventos

#### Evento 1: `LeituraDistancia`
- **Nome:** `LeituraDistancia`
- **Produtor:** `esp32-mesa-01 / sensor-ultrassonico`
- **Entidade observada:** `estudante-cadeira-estudo`
- **Tempo do evento:** Timestamp em formato ISO 8601 UTC (gerado no microcontrolador no momento exato da leitura do sensor)
- **Campos:** 
  - `distancia_cm` (float) — distância medida entre o sensor e o estudante
  - `qualidade_sinal` (int) — indicador da integridade/confiabilidade da leitura
- **Unidade:** Centímetros (`cm`)
- **Identificador / Número de sequência:** `seq_num` (inteiro sequencial incremental)

#### Evento 2: `MudancaEstadoPresenca`
- **Nome:** `MudancaEstadoPresenca`
- **Produtor:** `esp32-mesa-01 / filtro-presenca`
- **Entidade observada:** `estudante-sessao-estudo`
- **Tempo do evento:** Timestamp em formato ISO 8601 UTC (no instante de confirmação da mudança de estado)
- **Campos:** 
  - `estado_atual` (string: `"PRESENTE"` ou `"AUSENTE"`)
  - `distancia_media_cm` (float)
- **Unidade:** Não aplicável (campo de estado categórico)
- **Identificador / Número de sequência:** `seq_num` (inteiro sequencial) e `event_id` (UUIDv4)

---

### 3. Exemplos

#### Instância do Evento 1 (`LeituraDistancia`)
```json
{
  "event_type": "LeituraDistancia",
  "event_id": "evt-dist-104928",
  "seq_num": 104928,
  "producer_id": "esp32-mesa-01",
  "entity_id": "estudante-cadeira-estudo",
  "timestamp": "2026-08-28T14:30:00.000Z",
  "payload": {
    "distancia_cm": 52.4,
    "qualidade_sinal": 98
  }
}
```

#### Instância do Evento 2 (`MudancaEstadoPresenca`)
```json
{
  "event_type": "MudancaEstadoPresenca",
  "event_id": "evt-pres-00341",
  "seq_num": 341,
  "producer_id": "esp32-mesa-01",
  "entity_id": "estudante-sessao-estudo",
  "timestamp": "2026-08-28T14:30:05.000Z",
  "payload": {
    "estado_atual": "PRESENTE",
    "distancia_media_cm": 53.1
  }
}
```

---

### 4. Qualidade

- **Validação necessária:** Validação de faixa física do sensor (`5 cm <= distancia_cm <= 300 cm`).
- **Reconhecimento de evento inválido:** Caso o sensor retorne valores fora desse intervalo (por exemplo `0 cm` ou `450 cm`), o evento é marcado como ruído e descartado imediatamente.
- **Reconhecimento de evento duplicado ou desatualizado:** O nó de processamento mantém o `ultimo_seq_num` processado. Se chegar um evento com `seq_num <= ultimo_seq_num`, o sistema o identifica como duplicado/fora de ordem e o descarta. Além disso, se `(tempo_atual - timestamp_evento) > 5 segundos` (watermark), o evento é classificado como desatualizado.

---

## Parte 2 - Processamento temporal

### 5. Operações

```
Fenômeno físico (Estudante na mesa)
  │
  ▼
[ 1. Validação de Intervalo Físico ] ──> Filtra ruídos brutos (distância < 5cm ou > 300cm)
  │
  ▼
[ 2. Filtragem e Transformação ] ──────> Aplica média móvel (3s) e classifica (distância < 80cm = PRESENTE)
  │
  ▼
[ 3. Agrupamento em Janela ] ──────────> Contabiliza tempo contínuo acumulado de estudo na janela
  │
  ▼
[ 4. Detecção de Regra e Atuação ] ────> Se tempo >= 50 min, aciona LED, Buzzer e notificação
```

---

### 6. Estado e janela

- **Regra do sistema:** Disparar o lembrete de lanche quando o estudante acumular **50 minutos** de presença na mesa de estudos, tolerando breves ausências de até 2 minutos sem resetar o contador.
- **Tipo de janela:** Janela deslizante (*Sliding Window*) baseada na sessão contínua de presença com limite máximo de inatividade de 2 minutos.
- **Duração da janela:** Até 50 minutos de estudo acumulado.
- **Frequência de avaliação:** A cada 1 segundo (a cada nova leitura emitida pelo sensor).
- **Estado mantido:**
  - `tempo_estudo_sec`: tempo total acumulado em segundos no estado presente.
  - `status_atual`: estado do usuário (`PRESENTE` ou `AUSENTE`).
  - `inicio_ausencia`: timestamp em que a ausência começou (para verificar se excede a tolerância de 2 min).
  - `alerta_disparado`: flag booleano indicando se a atuação já ocorreu.

---

### 7. Semântica temporal

A regra utiliza o **Tempo do Evento (*Event Time*)**, registrado no microcontrolador no momento da leitura do sensor.

**Justificativa:** Em redes locais ou sem fio, latências ou pequenos engasgos de transmissão Wi-Fi podem atrasar a entrega de eventos. Se usássemos o *Tempo de Processamento (Processing Time)*, o contador acumularia tempo incorretamente ou geraria disparos falsos. O *Event Time* garante precisão física da medição da sessão de estudo.

---

### 8. Eventos atrasados

- **Decisão:** **Descartar com Tolerância Estrita (Watermark de 5 segundos)**.
- **Explicação:** Trata-se de um sistema interativo em tempo real para o ambiente físico. Se um evento de leitura chegar com mais de 5 segundos de atraso em relação ao relógio local, ele perde a relevância para a decisão do momento presente. O sistema descarta o evento atrasado se ele ultrapassar o watermark de 5s, garantindo que o estado não seja corrompido por eventos desatualizados.

---

### 9. Pseudocódigo

```python
// Constantes da regra
LIMITE_DISTANCIA = 80.0    // cm
TEMPO_ALERTA     = 3000    // 50 minutos em segundos
TOLERANCIA_AUS   = 120     // 2 minutos de tolerância em segundos
MAX_ATRASO       = 5       // watermark de 5 segundos

// Estado mantido na Borda
estado = {
    "tempo_estudo_sec": 0,
    "status": "AUSENTE",
    "inicio_ausencia": null,
    "ultimo_timestamp": null,
    "alerta_disparado": false
}

funcao processarEventoLeitura(evento):
    // 1. Validação do evento
    se (evento.payload.distancia_cm < 5.0 ou evento.payload.distancia_cm > 300.0) entao:
        retornar // Dado inválido

    tempo_atual = evento.timestamp
    se (estado.ultimo_timestamp != null e (tempo_atual - evento.timestamp) > MAX_ATRASO) entao:
        retornar // Dado atrasado descartado pelo watermark

    dt = (estado.ultimo_timestamp == null) ? 1 : (tempo_atual - estado.ultimo_timestamp)
    estado.ultimo_timestamp = tempo_atual

    // 2. Classificação de presença
    presenca_ativa = (evento.payload.distancia_cm < LIMITE_DISTANCIA)

    se (presenca_ativa) entao:
        estado.status = "PRESENTE"
        estado.inicio_ausencia = null
        estado.tempo_estudo_sec += dt

        // 3. Verificação da regra e resposta
        se (estado.tempo_estudo_sec >= TEMPO_ALERTA e nao estado.alerta_disparado) entao:
            acionarAtuadoresLocal("Hora do Lanche! 50 minutos de estudo atingidos.")
            estado.alerta_disparado = true

    senao: // Ausente (distância >= 80cm)
        se (estado.status == "PRESENTE") entao:
            se (estado.inicio_ausencia == null) entao:
                estado.inicio_ausencia = tempo_atual

            tempo_ausente = tempo_atual - estado.inicio_ausencia
            
            // Se ultrapassar a tolerância de 2 minutos, reseta a sessão
            se (tempo_ausente > TOLERANCIA_AUS) entao:
                estado.status = "AUSENTE"
                estado.tempo_estudo_sec = 0
                estado.alerta_disparado = false
                desativarAtuadoresLocal()
```

---

## Parte 3 - Distribuição e resiliência

### 10. Distribuição de responsabilidades

| Operação / Estado | Dispositivo (Sensor HC-SR04) | Borda (ESP32) | Nuvem (Servidor API Telegram - Opcional) |
| :--- | :---: | :---: | :---: |
| Emissão da onda ultrassônica e leitura elétrica | **X** | | |
| Validação, filtragem e classificação do evento | | **X** | |
| Manutenção do estado e timer de 50 minutos | | **X** | |
| Decisão da regra e atuação no LED/Buzzer local | | **X** | |
| Envio de notificação Push no Telegram | | **X** | **X** |

---

### 11. Justificativas

1. **Processamento da regra e estado mantido na Borda (ESP32):**
   - **Critérios (Latência e Conectividade):** Ao processar o temporizador de 50 minutos e acionar o LED/Buzzer diretamente no ESP32, o sistema garante resposta imediata (latência < 10ms) e permanece 100% funcional mesmo sem acesso à internet.
2. **Eliminação da dependência de Nuvem para a lógica principal:**
   - **Critérios (Simplicidade, Privacidade e Custo):** Como a aplicação é individual e doméstica, manter a inteligência na Borda elimina custos com infraestrutura em nuvem, simplifica a arquitetura do protótipo e preserva a privacidade dos dados de rotina do estudante dentro da rede local.

---

### 12. Comportamento diante de falhas

- **Falha escolhida:** **Perda de conexão Wi-Fi / Indisponibilidade de Internet**.
- **Comportamento e degradação:**
  - O sistema opera em modo de **degradação graciosa (Fallback Local)**.
  - Como toda a lógica, validações, estado e temporizador residem na memória do ESP32 (Borda), o sensor ultrassônico e os atuadores locais (LED e Buzzer) continuam funcionando sem qualquer prejuízo.
  - O único serviço degradado é o envio da notificação no celular via Telegram Bot. O estudante continua recebendo o aviso de pausa normalmente por meio dos sinais visuais e sonoros instalados em sua mesa de estudo.

---

### 13. Diagrama

```
+-----------------------------------------------------------------------------------+
| DISPOSITIVO (Sensor Ultrassônico HC-SR04)                                         |
|                                                                                   |
|  [ Sinal Físico / Eco ] ──(Pino GPIO - Leitura Elétrica)──> Borda                 |
+---------------------------------------------------+-------------------------------+
                                                    │
                                                    ▼
+-----------------------------------------------------------------------------------+
| BORDA / EDGE (Microcontrolador ESP32)                                             |
|                                                                                   |
|  1. Recepção de Evento: LeituraDistancia                                         |
|  2. Operações: Validação de faixa -> Filtragem -> Classificação PRESENTE/AUSENTE  |
|  3. Estado Mantido: Janela Slided 50 min + Tolerância 2 min                      |
|  4. Decisão: Se tempo >= 50 min -> Disparar Pinos dos Atuadores                   |
|  5. Atuação Local: [ LED RGB ] & [ Buzzer Piezoelétrico ]                         |
+---------------------------------------------------+-------------------------------+
                                                    │ Wi-Fi / HTTP (Se disponível)
                                                    ▼
+-----------------------------------------------------------------------------------+
| NUVEM / EXTERNO (Servidor Telegram Bot API - Opcional)                            |
|                                                                                   |
|  [ API Telegram ] ──> Notificação Push no Smartphone do Estudante                 |
+-----------------------------------------------------------------------------------+
```
