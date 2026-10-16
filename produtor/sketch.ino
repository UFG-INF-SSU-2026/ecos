#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <esp_system.h>
#include <time.h>

#include "secrets.h"

const int TRIG_PIN = 4;
const int ECHO_PIN = 2;
const int CAMERA_PIN = 14;
const int BOTAO_FALHA = 12;
const int LED_VERDE = 25;
const int LED_VERMELHO = 27;
const int BUZZER = 19;

const unsigned long TEMPO_PAUSA = 10000;
const unsigned long TEMPO_CONEXAO_NTP = 15000;
const int TENTATIVAS_HTTP = 3;

unsigned long tempoEstudo = 0;
unsigned long ultimaAtualizacao = 0;
unsigned long sequenciaEvento = 0;
String identificadorBoot;
bool relogioSincronizado = false;

float medirDistancia() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long duracao = pulseIn(ECHO_PIN, HIGH, 30000);
  if (duracao == 0) return -1;

  return duracao * 0.0343 / 2.0;
}

bool cameraDetectaPessoa() {
  // A câmera é representada no protótipo por um sinal digital já processado:
  // HIGH = pessoa detectada; LOW = pessoa não detectada.
  return digitalRead(CAMERA_PIN) == HIGH;
}

void tocarAlerta() {
  tone(BUZZER, 1000);
  delay(1500);
  noTone(BUZZER);
}

bool sincronizarRelogio() {
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  Serial.print("Sincronizando relogio para validar o certificado TLS");

  unsigned long inicio = millis();
  time_t agora = time(nullptr);
  while (agora < 1700000000 && millis() - inicio < TEMPO_CONEXAO_NTP) {
    delay(250);
    Serial.print(".");
    agora = time(nullptr);
  }

  if (agora < 1700000000) {
    Serial.println("\nNao foi possivel sincronizar o relogio.");
    return false;
  }

  Serial.println("\nRelogio sincronizado.");
  return true;
}

bool reconectarWiFi() {
  Serial.println("Evento aguardando recuperacao da comunicacao...");
  while (digitalRead(BOTAO_FALHA) == LOW) delay(500);

  Serial.println("Falha encerrada. Tentando recuperar a conexao Wi-Fi...");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD, 6);

  unsigned long inicio = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - inicio < 10000) {
    delay(500);
    Serial.print(".");
  }

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("\nNao foi possivel recuperar a conexao Wi-Fi.");
    return false;
  }

  Serial.println("\nWi-Fi reconectado.");
  relogioSincronizado = sincronizarRelogio();
  return relogioSincronizado;
}

bool enviarEventoHTTP() {
  sequenciaEvento++;
  const String eventId = "evt-" + identificadorBoot + "-" + String(sequenciaEvento);
  String json = "{";
  json += "\"schemaVersion\":2,";
  json += "\"eventId\":\"" + eventId + "\",";
  json += "\"deviceId\":\"esp32-mesa-01\",";
  json += "\"eventType\":\"study.break.required\",";
  json += "\"state\":\"PAUSA_RECOMENDADA\",";
  json += "\"sensorConfirmacao\":\"ultrassonico+camera\"";
  json += "}";

  Serial.println("\n=== EVENTO GERADO ===");
  Serial.println(json);

  if (digitalRead(BOTAO_FALHA) == LOW) {
    Serial.println("FALHA SIMULADA: comunicacao Wi-Fi indisponivel.");
    WiFi.disconnect();
    delay(500);
  }

  if (WiFi.status() != WL_CONNECTED && !reconectarWiFi()) return false;
  if (!relogioSincronizado && !sincronizarRelogio()) return false;

  for (int tentativa = 1; tentativa <= TENTATIVAS_HTTP; tentativa++) {
    Serial.printf("Enviando evento por HTTPS (tentativa %d/%d)...\n", tentativa, TENTATIVAS_HTTP);

    WiFiClientSecure client;
    client.setCACert(API_ROOT_CA);

    HTTPClient http;
    http.setConnectTimeout(15000);
    http.setTimeout(65000);

    if (!http.begin(client, API_URL)) {
      Serial.println("Falha ao iniciar a conexao HTTPS.");
      delay(1000);
      continue;
    }

    http.addHeader("Content-Type", "application/json");
    http.addHeader("Authorization", String("Bearer ") + API_BEARER_TOKEN);
    http.addHeader("X-Device-Id", "esp32-mesa-01");

    const int codigoHTTP = http.POST(json);
    const String resposta = codigoHTTP > 0 ? http.getString() : "";
    http.end();

    if (codigoHTTP >= 200 && codigoHTTP < 300) {
      Serial.print("SUCESSO - HTTP ");
      Serial.println(codigoHTTP);
      Serial.println(resposta);
      return true;
    }

    Serial.print("FALHA DE COMUNICACAO - HTTP ");
    Serial.println(codigoHTTP);
    if (resposta.length()) Serial.println(resposta);
    if (tentativa < TENTATIVAS_HTTP) delay(1500);
  }

  Serial.println("Evento nao confirmado; o mesmo eventId foi mantido nas tentativas.");
  return false;
}

void setup() {
  Serial.begin(115200);

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(CAMERA_PIN, INPUT);
  pinMode(BOTAO_FALHA, INPUT_PULLUP);
  pinMode(LED_VERDE, OUTPUT);
  pinMode(LED_VERMELHO, OUTPUT);
  pinMode(BUZZER, OUTPUT);

  identificadorBoot = String((uint32_t)esp_random(), HEX);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD, 6);

  Serial.print("Conectando ao Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("\nWi-Fi conectado.");
  relogioSincronizado = sincronizarRelogio();
  ultimaAtualizacao = millis();
}

void loop() {
  const unsigned long agora = millis();
  const unsigned long intervalo = agora - ultimaAtualizacao;
  ultimaAtualizacao = agora;

  const float distancia = medirDistancia();
  if (distancia < 0) {
    Serial.println("Leitura do sensor ultrassonico invalida.");
    delay(1000);
    return;
  }

  const bool presencaUltrassonico = distancia < 80;
  const bool presencaCamera = cameraDetectaPessoa();
  const bool estudantePresente = presencaUltrassonico && presencaCamera;

  Serial.print("Ultrassonico: ");
  Serial.print(presencaUltrassonico ? "PRESENCA" : "AUSENCIA");
  Serial.print(" | Camera: ");
  Serial.println(presencaCamera ? "PRESENCA" : "AUSENCIA");

  if (estudantePresente) {
    digitalWrite(LED_VERDE, HIGH);
    digitalWrite(LED_VERMELHO, LOW);
    tempoEstudo += intervalo;

    Serial.print("PRESENTE | Tempo: ");
    Serial.print(tempoEstudo / 1000);
    Serial.println("s");

    if (tempoEstudo >= TEMPO_PAUSA) {
      digitalWrite(LED_VERDE, LOW);
      digitalWrite(LED_VERMELHO, HIGH);
      Serial.println("\nPAUSA_RECOMENDADA");
      enviarEventoHTTP();
      tocarAlerta();
      while (true) delay(1000);
    }
  } else {
    digitalWrite(LED_VERDE, LOW);
    digitalWrite(LED_VERMELHO, LOW);
    Serial.println("AUSENTE");
  }

  delay(1000);
}
