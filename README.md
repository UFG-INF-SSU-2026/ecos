# Atividade em Grupo 01 — Análise inicial de um sistema ubíquo

**Cenário escolhido:** Lembrete Inteligente de Lanche para Estudo em Casa

**Integrantes:** Ana Liz Bomfim Gomes, Christopher Star Correa de Oliveira, Gustavo Alves Marçal, Mateus Silva de Sousa

---

## Parte 1 - Compreensão do problema

### 1. Problema e usuários

Estudantes universitários que passam muitas horas seguidas estudando ou programando em casa costumam perder a noção do tempo, esquecendo-se de fazer pausas básicas para se alimentar ou tomar água. Lembretes fixos no celular muitas vezes são ignorados por não considerarem a presença real do estudante na mesa de estudos.

Os usuários principais são **estudantes e autônomos** trabalhando em ambiente doméstico. A situação de uso ocorre durante longas sessões individuais de estudo/trabalho no quarto ou escritório de casa.

### 2. Contexto

Para funcionar adequadamente, o sistema precisa perceber:
- **Sobre o usuário:** Presença física na cadeira/mesa de estudo (se está ativamente estudando ou se já se levantou);
- **Sobre o ambiente:** Presença básica (sem necessidade de medir variáveis complexas como CO₂, umidade ou temperatura);
- **Sobre o sistema:** Tempo decorrido desde a última pausa detectada e estado do alerta (ativo/inativo).

### 3. Dispositivos e comunicação

Participam do sistema:
- **1 Sensor de presença/distância simples:** Sensor ultrassônico (HC-SR04) ou sensor infravermelho/PIR posicionado na mesa de estudos;
- **1 Microcontrolador:** ESP32 ou Arduino com módulo Wi-Fi embutido;
- **1 Atuador visual/sonoro simples:** LED RGB / Buzzer piezoelétrico (ou notificação simples no Telegram/celular via Wi-Fi).

A comunicação ocorre diretamente via pinos GPIO do microcontrolador (conexão física em protoboard). Caso o alerta vá para o celular, a comunicação ocorre via requisição HTTP simples pela rede Wi-Fi residencial.

### 4. Processamento e resposta

O processamento ocorre de forma **100% local no próprio microcontrolador (Edge Computing)** por meio de uma lógica de temporização simples:
- O sensor detecta a presença do aluno na mesa.
- Se o aluno permanecer na mesa continuamente por mais de 50 minutos, o microcontrolador aciona o alerta (LED acende em vermelho e toca um bipe suave no buzzer ou envia mensagem no Telegram: *"Hora da pausa para o lanche!"*).
- Se o aluno se levantar da mesa, o timer é pausado ou zerado automaticamente.

### 5. Risco principal

O risco principal identificado é a **falsa detecção de presença / falso alarme**. Caso o sensor detecte a cadeira vazia como presença (ou perca o sinal quando o aluno fica parado em leitura), o contador de tempo pode falhar ou resetar indevidamente. Esse risco é mitigado utilizando uma lógica simples de software (suavização/debounce de leitura por alguns segundos antes de resetar o timer).

---

## Parte 2 - Modelagem do sistema

### 6. Sensores, atuadores e gateway

- **Sensor:** Sensor ultrassônico de distância (HC-SR04) — mede a distância até o estudante para confirmar sua presença na mesa;
- **Atuador:** LED RGB / Buzzer piezoelétrico — emite o sinal sonoro/luminoso suave de lembrete de pausa;
- **Gateway:** O próprio microcontrolador (ESP32) atua como gateway e nó de processamento local, pois lê os pinos GPIO diretamente sem necessidade de infraestrutura de rede complexa.

### 7. Fluxo do sistema

```
Fenômeno físico (Estudante sentado na mesa de estudos)
        -> Sensor (Ultrassônico HC-SR04 mede distância < 80cm)
        -> Gateway/Hardware (ESP32 lê os pinos GPIO)
        -> Processamento (Timer interno contabiliza tempo contínuo de presença)
        -> Decisão (Tempo contínuo > 50 min? Se sim, disparar alerta)
        -> Resposta/Atuador (Acende LED vermelho e toca bipe suave no Buzzer)
```

### 8. Classificação

O sistema pode ser classificado como:
- **Aplicação Ubíqua:** Pois está embutida no ambiente de estudo de forma discreta, monitorando o hábito do usuário sem exigir interações manuais (como iniciar um cronômetro no celular);
- **IoT (Internet das Coisas):** Caso esteja conectado à rede Wi-Fi residencial para enviar notificações para o smartphone do usuário ou registrar o histórico de pausas.

### 9. Contexto e adaptação

Uma mudança de contexto relevante é o **afastamento do estudante da mesa de estudos** (ir ao banheiro, buscar água ou descansar). Quando o sensor detecta distância maior que o limite predefinido (cadeira vazia), o sistema adapta seu comportamento pausando o timer de estudo. Ao retornar, o ciclo é ajustado, garantindo que o lembrete de lanche só seja acionado após tempo de estudo efetivo.
