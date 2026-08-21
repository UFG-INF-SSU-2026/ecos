# Atividade em Grupo 01 — Análise inicial de um sistema ubíquo

**Cenário escolhido:** Sala de aula inteligente (ocupação, conforto e consumo de energia)

**Integrantes:** Ana Liz Bomfim Gomes, Christopher Star Correa de Oliveira, Gustavo Alves Marçal, Mateus Silva de Sousa

---

## Parte 1 - Compreensão do problema

### 1. Problema e usuários

O sistema busca resolver o desperdício de energia e o desconforto térmico/luminoso em salas de aula universitárias, causados pela falta de ajuste automático de iluminação, climatização e ventilação conforme a real ocupação e as condições ambientais. Hoje esses ajustes dependem de ação manual de professores, alunos ou da equipe de manutenção, o que gera equipamentos ligados sem necessidade (salas vazias com ar-condicionado ligado, luzes acesas fora do horário de aula) e ambientes desconfortáveis (salas quentes, abafadas ou mal iluminadas durante o uso).

Os usuários principais são:
- **Professores e alunos**, que usam a sala e são impactados pelo conforto do ambiente;
- **Equipe de gestão predial/manutenção da universidade**, responsável por monitorar consumo e funcionamento dos equipamentos;
- **Coordenação acadêmica**, interessada em dados de ocupação para otimizar o uso dos espaços.

A situação de uso é o cotidiano de uma sala de aula em um prédio universitário, com horários de aula variáveis, ocupação que muda ao longo do dia e diferentes condições climáticas externas ao longo do ano.

### 2. Contexto

Para funcionar adequadamente, o sistema precisa perceber:
- **Sobre o usuário:** número de pessoas presentes na sala (ocupação), possivelmente horário previsto de aula (via integração com grade horária);
- **Sobre o ambiente:** temperatura e umidade internas, nível de luminosidade natural, concentração de CO₂ (indicador de ventilação/conforto), temperatura externa;
- **Sobre o sistema:** estado atual dos atuadores (ar-condicionado ligado/desligado, luzes acesas/apagadas, posição de persianas), consumo de energia em tempo real, status de conectividade dos dispositivos.

### 3. Dispositivos e comunicação

Participam do sistema:
- Sensores de presença/ocupação (PIR ou câmeras contadoras de pessoas);
- Sensores de temperatura, umidade e CO₂;
- Sensor de luminosidade;
- Medidor de consumo de energia (smart plug ou medidor no quadro elétrico);
- Atuadores: relés para luzes, controle de ar-condicionado (via IR ou integração smart), motor de persianas;
- Um **gateway local** na sala (ou por andar/bloco), que coleta os dados dos sensores via protocolos de baixo consumo (Zigbee, Wi-Fi ou LoRa) e os envia para um servidor central via rede da universidade (Wi-Fi/Ethernet);
- Servidor/plataforma central, que processa os dados e envia comandos de volta ao gateway.

A comunicação ocorre em duas vias: sensores → gateway → nuvem/servidor (dados) e servidor → gateway → atuadores (comandos), tipicamente usando MQTT para a comunicação entre gateway e servidor.

### 4. Processamento e resposta

O processamento pode ocorrer em dois níveis:
- **Borda (edge, no gateway local):** decisões simples e de baixa latência, como acender a luz ao detectar presença ou desligar o ar-condicionado poucos minutos após a sala esvaziar;
- **Nuvem/servidor central:** processamento mais complexo, como cruzar dados históricos de ocupação com a grade horária para antecipar o pré-condicionamento da sala antes do início da aula, gerar relatórios de consumo e detectar padrões de uso.

As respostas produzidas incluem: ajuste automático de iluminação e climatização conforme ocupação e conforto, recomendações de manutenção quando sensores indicam mau funcionamento, e alertas de consumo elevado para a gestão predial.

### 5. Risco principal

O risco principal identificado é **privacidade**, decorrente do uso de sensores de ocupação (especialmente se forem câmeras) dentro de salas de aula, o que pode gerar dados sensíveis sobre presença e comportamento de professores e alunos. Esse risco é mitigado priorizando sensores de presença não identificáveis (PIR, contadores por infravermelho) em vez de câmeras, e evitando o armazenamento de dados individualizados, mantendo apenas contagens agregadas de ocupação.

Um risco secundário relevante é **confiabilidade/conectividade**: falhas na rede podem impedir o ajuste automático dos ambientes, exigindo que o sistema tenha um modo de operação local (fallback) no gateway, capaz de manter decisões básicas mesmo sem conexão com o servidor central.

---

## Parte 2 - Modelagem do sistema

### 6. Sensores, atuadores e gateway

- **Sensores:** presença/ocupação, temperatura, umidade, CO₂ e luminosidade — capturam o estado físico da sala;
- **Atuadores:** relés de iluminação, controle do ar-condicionado, motor de persianas — executam as respostas decididas pelo sistema;
- **Gateway:** dispositivo local (ex.: um microcontrolador com conectividade Wi-Fi/Zigbee) que agrega os dados dos sensores da sala, realiza decisões locais simples (edge computing) e faz a ponte de comunicação entre a sala e o servidor central, além de receber e repassar comandos aos atuadores.

### 7. Fluxo do sistema

```
Fenômeno físico (presença de pessoas, temperatura, luz)
        -> Sensor (PIR, termômetro, luxímetro, CO2)
        -> Comunicação/Gateway (agregação local via Zigbee/Wi-Fi)
        -> Processamento (edge no gateway + servidor central na nuvem)
        -> Decisão (regra de conforto/economia de energia, cruzando ocupação e horário de aula)
        -> Resposta/Atuador (liga/desliga luz e ar-condicionado, ajusta persiana)
```

Exemplo concreto: um aluno entra na sala → sensor de presença detecta ocupação → gateway envia o dado ao servidor → servidor verifica temperatura atual e horário da aula → decide ligar o ar-condicionado em modo economia → comando é enviado de volta ao gateway → atuador liga o ar-condicionado.

### 8. Classificação

O sistema pode ser classificado como:
- **Sistema ciber-físico**, pois integra sensoriamento físico, processamento computacional e atuação sobre o ambiente físico em um laço de controle contínuo;
- **IoT (Internet das Coisas)**, pois os dispositivos (sensores e atuadores) são conectados em rede e se comunicam com uma plataforma central pela internet/rede da universidade;
- **Aplicação ubíqua**, pois a computação está embutida no ambiente de forma discreta, respondendo automaticamente à presença e às necessidades dos usuários sem exigir interação explícita.

As três classificações se complementam: o aspecto ciber-físico descreve a integração sensor-atuador-processamento, o IoT descreve a infraestrutura de conectividade, e a ubiquidade descreve a experiência do usuário, que não precisa operar o sistema manualmente.

### 9. Contexto e adaptação

Uma mudança de contexto relevante é a **alteração do número de ocupantes ao longo do dia** (sala cheia durante uma aula, vazia no intervalo, com poucas pessoas em uma monitoria). O sistema deve adaptar o comportamento dos atuadores proporcionalmente: com sala cheia, aumentar a climatização e ventilação para manter o conforto e o nível de CO₂ adequado; com sala vazia, desligar luzes e reduzir/desligar o ar-condicionado após um período de inatividade, evitando desperdício.

Outra mudança de contexto é a **variação da luminosidade natural** ao longo do dia: em dias muito claros, o sistema pode reduzir a iluminação artificial e ajustar as persianas para evitar ofuscamento, e em dias nublados ou à noite, aumentar a iluminação artificial automaticamente.
