# Atividade em Grupo 01 — Análise inicial de um sistema ubíquo

> **Para executar a implementação atual:** siga o [passo a passo de reprodução local](instrucoes-execucao.md), com API e banco no Docker, app Expo e sensor no Wokwi. A demonstração gera pausas recorrentes a cada 30 segundos de presença, somente enquanto o sensor está ativado no aplicativo.

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
- **2 Sensores de presença (fusão de sensores):** Sensor ultrassônico (HC-SR04), que mede a distância até o estudante, e um sensor de câmera, que detecta a presença de uma pessoa de forma independente. A presença só é confirmada quando os dois sensores concordam;
- **1 Microcontrolador:** ESP32 ou Arduino com módulo Wi-Fi embutido;
- **1 Atuador visual/sonoro simples:** LED RGB / Buzzer piezoelétrico (ou notificação simples no Telegram/celular via Wi-Fi).

A comunicação ocorre diretamente via pinos GPIO do microcontrolador (conexão física em protoboard). Caso o alerta vá para o celular, a comunicação ocorre via requisição HTTP simples pela rede Wi-Fi residencial.

### 4. Processamento e resposta

O processamento ocorre de forma **100% local no próprio microcontrolador (Edge Computing)** por meio de uma lógica de temporização simples:
- O sensor ultrassônico e o sensor de câmera detectam a presença do aluno na mesa, de forma independente; a presença só é considerada confirmada quando os dois sensores concordam (fusão de sensores).
- Se o aluno permanecer na mesa continuamente por mais de 50 minutos, o microcontrolador aciona o alerta (LED acende em vermelho e toca um bipe suave no buzzer ou envia mensagem no Telegram: *"Hora da pausa para o lanche!"*).
- Se o aluno se levantar da mesa (ou algum dos dois sensores deixar de confirmar a presença), o timer é pausado ou zerado automaticamente.

### 5. Risco principal

O risco principal identificado é a **falsa detecção de presença / falso alarme**. Caso o sensor detecte a cadeira vazia como presença (ou perca o sinal quando o aluno fica parado em leitura), o contador de tempo pode falhar ou resetar indevidamente. Esse risco é mitigado principalmente pela **fusão dos dois sensores** (ultrassônico + câmera): a presença só é confirmada quando ambos concordam, reduzindo a chance de um único sensor com ruído disparar um falso positivo isoladamente.

---

## Parte 2 - Modelagem do sistema

### 6. Sensores, atuadores e gateway

- **Sensor 1:** Sensor ultrassônico de distância (HC-SR04) — mede a distância até o estudante para confirmar sua presença na mesa;
- **Sensor 2:** Sensor de câmera — detecta a presença de uma pessoa de forma independente do sensor ultrassônico, participando da fusão de sensores;
- **Atuador:** LED RGB / Buzzer piezoelétrico — emite o sinal sonoro/luminoso suave de lembrete de pausa;
- **Gateway:** O próprio microcontrolador (ESP32) atua como gateway e nó de processamento local, pois lê os pinos GPIO diretamente sem necessidade de infraestrutura de rede complexa.

### 7. Fluxo do sistema

```
Fenômeno físico (Estudante sentado na mesa de estudos)
        -> Sensor 1 (Ultrassônico HC-SR04 mede distância < 80cm)
        -> Sensor 2 (Câmera detecta presença de pessoa)
        -> Fusão de sensores (Presença só é confirmada se os dois sensores concordarem)
        -> Gateway/Hardware (ESP32 lê os pinos GPIO)
        -> Processamento (Timer interno contabiliza tempo contínuo de presença confirmada)
        -> Decisão (Tempo contínuo > 50 min? Se sim, disparar alerta)
        -> Resposta/Atuador (Acende LED vermelho e toca bipe suave no Buzzer)
```

### 8. Classificação

O sistema pode ser classificado como:
- **Aplicação Ubíqua:** Pois está embutida no ambiente de estudo de forma discreta, monitorando o hábito do usuário sem exigir interações manuais (como iniciar um cronômetro no celular);
- **IoT (Internet das Coisas):** Caso esteja conectado à rede Wi-Fi residencial para enviar notificações para o smartphone do usuário ou registrar o histórico de pausas.

### 9. Contexto e adaptação

Uma mudança de contexto relevante é o **afastamento do estudante da mesa de estudos** (ir ao banheiro, buscar água ou descansar). Quando o sensor ultrassônico detecta distância maior que o limite predefinido (cadeira vazia) ou o sensor de câmera deixa de detectar presença, a fusão de sensores deixa de confirmar a presença e o sistema adapta seu comportamento pausando o timer de estudo. Ao retornar, o ciclo é ajustado, garantindo que o lembrete de lanche só seja acionado após tempo de estudo efetivo confirmado pelos dois sensores.

---

## Aplicativo móvel, controle do sensor e histórico

A implementação atual inclui:

- **React Native + Expo** em `mobile/`: login, acompanhamento de dispositivos, ativação/desativação e histórico por usuário com filtros e paginação.
- **API Node.js** em `consumidor/`: autenticação, autorização por proprietário, comandos versionados e WebSocket para o app.
- **TimescaleDB** com volume persistente, eventos temporais e deduplicação durável.
- **Firmware ESP32/Wokwi** em `produtor/`: telemetria, alertas, consulta de comandos e confirmação da ativação/desativação, mantendo comunicação após o alerta.

Na pasta `ecos`, inicie com:

```bash
node scripts/setup.mjs
docker compose up --build -d --wait
docker compose exec api node scripts/provision.js
```

Em outro terminal, execute `cloudflared tunnel --url http://localhost:3000` e mantenha-o aberto. Configure a URL HTTPS gerada em `mobile/.env` (`EXPO_PUBLIC_API_URL`) e em `produtor/secrets.h` (`API_BASE_URL`), sem `/api/v1` e sem barra final. Em `mobile/`, execute `npm ci` e `npm start -- --clear`, e entre com `USER_EMAIL`/`USER_PASSWORD` do `.env` da raiz.

Para o site do Wokwi, copie `sketch.ino`, `diagram.json`, `secrets.h` configurado e `libraries.txt` da pasta `produtor/`. Ative o sensor pelo app e confirme presença com distância abaixo de 80 cm e chave da câmera em HIGH. As pausas se repetem a cada 30 segundos; após a confirmação da desativação no app, a contagem é zerada e novas pausas deixam de ser geradas. Ao reativar, começa outro ciclo do zero. O [guia completo](instrucoes-execucao.md) detalha instalação, arquivos, validação e solução de erros de JSON/TLS.

- [Instruções completas de execução e testes](instrucoes-execucao.md)
- [Arquitetura, segurança e limites](configuracoes.md)
- [Contrato HTTP/WebSocket do app e dispositivo](contrato/mobile-api.md)

O texto das atividades iniciais acima descreve a proposta original; o fluxo atual inclui processamento local, middleware e persistência temporal. O consumidor WebSocket antigo permanece no repositório apenas como referência histórica.
