#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <esp_system.h>
#include <time.h>
#include "secrets.h"

const int TRIG_PIN = 4, ECHO_PIN = 2, CAMERA_PIN = 14, BOTAO_FALHA = 12;
const int LED_VERDE = 25, LED_VERMELHO = 27, BUZZER = 19;
const unsigned long TEMPO_PAUSA = 30000; // Demonstracao: uma pausa a cada 30 s de presenca.
const unsigned long CONFIG_INTERVAL = 2000, TELEMETRY_INTERVAL = 15000;
String bootId, pendingBreak, pendingState, pendingTelemetry;
unsigned long sequence = 0, studyTime = 0, lastSample = 0;
unsigned long lastConfig = 0, lastSend = 0, lastTelemetry = 0, lastWifi = 0, lastNtp = 0, buzzerStarted = 0;
bool enabled = false, configLoaded = false, alertActive = false, buzzerOn = false;
int version = -1;
int networkStage = -1;

String url(const char* path) { return String(API_BASE_URL) + path; }
void outputsOff() {
  digitalWrite(LED_VERDE, LOW); digitalWrite(LED_VERMELHO, LOW);
  noTone(BUZZER); buzzerOn = false;
}
float distanceCm() {
  digitalWrite(TRIG_PIN, LOW); delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH); delayMicroseconds(10); digitalWrite(TRIG_PIN, LOW);
  unsigned long duration = pulseIn(ECHO_PIN, HIGH, 30000);
  return duration ? duration * 0.0343f / 2.0f : -1;
}
void envelope(JsonDocument& doc, const char* type) {
  doc["schemaVersion"] = 2;
  doc["eventId"] = "evt-" + bootId + "-" + String(++sequence);
  doc["deviceId"] = DEVICE_ID;
  doc["eventType"] = type;
}
String encode(JsonDocument& doc) { String result; serializeJson(doc, result); return result; }
// Uma tentativa por passagem, mantendo exatamente o mesmo JSON/eventId em caso de falha.
int exchange(const char* path, const String* body, String& response) {
  if (WiFi.status() != WL_CONNECTED || time(nullptr) < 1700000000) return -1;
  static WiFiClientSecure client; // Reutiliza TLS entre consultas para manter o ritmo da simulacao.
  client.setCACert(API_ROOT_CA); // Nunca desabilite a validação do servidor.
  client.setHandshakeTimeout(30); // Segundos; a validacao TLS no simulador pode ser lenta.
  static HTTPClient http;
  http.setReuse(true);
  http.setConnectTimeout(10000); http.setTimeout(10000); // Milissegundos.
  if (!http.begin(client, url(path))) {
    Serial.printf("HTTPS: nao foi possivel iniciar %s. Confira API_BASE_URL.\n", path);
    return -1;
  }
  http.addHeader("Authorization", String("Bearer ") + API_BEARER_TOKEN);
  http.addHeader("X-Device-Id", DEVICE_ID);
  int code;
  if (body) { http.addHeader("Content-Type", "application/json"); code = http.POST(*body); }
  else code = http.GET();
  if (code > 0) response = http.getString();
  else {
    Serial.printf("HTTPS %s: %s (codigo %d).\n", path, HTTPClient::errorToString(code).c_str(), code);
    char tlsError[192] = {};
    const int tlsCode = client.lastError(tlsError, sizeof(tlsError));
    if (tlsCode != 0) Serial.printf("TLS: %s (codigo %d).\n", tlsError, tlsCode);
    Serial.println("Confira se API_BASE_URL usa o tunel HTTPS atual e se ele continua ativo.");
    client.stop();
  }
  http.end();
  return code;
}
void sendPending(String& event) {
  if (event.isEmpty()) return;
  String response;
  const int code = exchange("/api/v1/eventos", &event, response);
  if (code >= 200 && code < 300) {
    Serial.printf("Evento persistido: HTTP %d\n", code);
    event = "";
  } else {
    Serial.printf("Evento pendente, HTTP %d (sera repetido com o mesmo ID).\n", code);
    if (!response.isEmpty()) Serial.println(response);
  }
}
void pollConfig() {
  // Confirma a transição anterior antes de aplicar outra; evita perder a auditoria.
  if (!pendingState.isEmpty()) return;
  String response;
  const int code = exchange("/api/v1/device/config", nullptr, response);
  if (code != 200) {
    Serial.printf("Configuracao ainda nao recebida: HTTP %d.\n", code);
    if (code == 401) Serial.println("Confira DEVICE_ID e API_BEARER_TOKEN com o cadastro da API.");
    else if (code == 404) Serial.println("Confira API_BASE_URL e a versao da API em execucao.");
    else if (code >= 500) Serial.println("Confira se a API e o tunel HTTPS continuam ativos.");
    return;
  }
  JsonDocument doc;
  const DeserializationError jsonError = deserializeJson(doc, response);
  if (jsonError) {
    Serial.printf("Configuracao: resposta nao e um JSON valido (%s). Confira API_BASE_URL.\n", jsonError.c_str());
    return;
  }
  if (!doc["enabled"].is<bool>() || !doc["version"].is<int>() ||
      doc["deviceId"].as<String>() != DEVICE_ID || doc["version"].as<int>() < 0) {
    Serial.println("Configuracao: campos invalidos ou DEVICE_ID diferente do esperado.");
    return;
  }
  const int receivedVersion = doc["version"].as<int>();
  const bool receivedEnabled = doc["enabled"].as<bool>();
  if (configLoaded && receivedVersion < version) return;
  if (configLoaded && receivedVersion == version && receivedEnabled == enabled) return;
  version = receivedVersion; enabled = receivedEnabled; configLoaded = true;
  studyTime = 0; alertActive = false; lastSample = millis(); outputsOff();
  JsonDocument state;
  envelope(state, "sensor.state.reported"); state["enabled"] = enabled; state["version"] = version;
  pendingState = encode(state);
  Serial.printf("CONFIGURACAO APLICADA: sensor %s | versao %d\n", enabled ? "ATIVADO" : "DESATIVADO", version);
}
void network() {
  const unsigned long now = millis();
  if (digitalRead(BOTAO_FALHA) == LOW) {
    if (networkStage != 0) Serial.println("Falha Wi-Fi simulada: GPIO 12 em LOW. Solte o botao Falha Wi-Fi.");
    networkStage = 0;
    if (WiFi.status() == WL_CONNECTED) WiFi.disconnect();
    return;
  }
  if (WiFi.status() != WL_CONNECTED) {
    if (networkStage != 1) Serial.printf("Wi-Fi: conectando a %s...\n", WIFI_SSID);
    networkStage = 1;
    if (now - lastWifi >= 5000) {
      lastWifi = now;
      Serial.printf("Wi-Fi: nova tentativa (status %d).\n", (int)WiFi.status());
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD, 6);
    }
    return;
  }
  if (networkStage < 2) Serial.printf("Wi-Fi conectado. IP: %s\n", WiFi.localIP().toString().c_str());
  if (time(nullptr) < 1700000000) {
    networkStage = 2;
    if (now - lastNtp >= 10000 || lastNtp == 0) {
      lastNtp = now;
      Serial.println("NTP: aguardando sincronizacao do relogio para validar HTTPS...");
      configTime(0, 0, "pool.ntp.org", "time.nist.gov");
    }
    return;
  }
  if (networkStage != 3) {
    networkStage = 3;
    Serial.println("Relogio sincronizado. Consultando configuracao por HTTPS...");
  }
  if (now - lastSend >= 2000) {
    lastSend = now;
    sendPending(pendingState); sendPending(pendingBreak); sendPending(pendingTelemetry);
  }
  if (millis() - lastConfig >= CONFIG_INTERVAL) { lastConfig = millis(); pollConfig(); }
}
void setup() {
  Serial.begin(115200);
  pinMode(TRIG_PIN, OUTPUT); pinMode(ECHO_PIN, INPUT); pinMode(CAMERA_PIN, INPUT);
  pinMode(BOTAO_FALHA, INPUT_PULLUP); pinMode(LED_VERDE, OUTPUT);
  pinMode(LED_VERMELHO, OUTPUT); pinMode(BUZZER, OUTPUT); outputsOff();
  bootId = String((uint32_t)esp_random(), HEX) + String((uint32_t)esp_random(), HEX);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD, 6);
  Serial.println("ECOS iniciado. Aguardando configuracao autenticada antes de ler sensores.");
  Serial.printf("API configurada: %s\n", API_BASE_URL);
}
void loop() {
  network();
  const unsigned long now = millis();
  if (alertActive && now - buzzerStarted >= 1500) {
    noTone(BUZZER); buzzerOn = false; alertActive = false;
  }
  if (now - lastSample < 500) { delay(10); return; }
  // Usa tempo decorrido, incluindo HTTPS; reavalia a presenca a cada amostra.
  const unsigned long interval = now - lastSample;
  lastSample = now;
  if (!configLoaded) { outputsOff(); return; }
  float distance = -1;
  bool present = false;
  if (enabled) {
    distance = distanceCm();
    present = distance >= 0 && distance < 80 && digitalRead(CAMERA_PIN) == HIGH;
    if (!present) { studyTime = 0; alertActive = false; outputsOff(); }
    else {
      // Mantem no maximo um ciclo pronto se o evento anterior aguardar envio.
      studyTime = min(studyTime + min(interval, TEMPO_PAUSA), TEMPO_PAUSA);
      digitalWrite(LED_VERDE, alertActive ? LOW : HIGH);
      digitalWrite(LED_VERMELHO, alertActive ? HIGH : LOW);
      if (studyTime >= TEMPO_PAUSA && pendingBreak.isEmpty()) {
        JsonDocument event; envelope(event, "study.break.required");
        event["state"] = "PAUSA_RECOMENDADA"; event["sensorConfirmacao"] = "ultrassonico+camera";
        pendingBreak = encode(event); alertActive = true; studyTime = 0;
        digitalWrite(LED_VERDE, LOW); digitalWrite(LED_VERMELHO, HIGH);
        tone(BUZZER, 1000); buzzerStarted = millis(); buzzerOn = true;
        Serial.printf("PAUSA_RECOMENDADA aos %lu ms. Novo ciclo de 30 s iniciado.\n", now);
      }
    }
  } else { studyTime = 0; outputsOff(); }
  // Backpressure: não produz outra telemetria enquanto a anterior não foi persistida.
  if (now - lastTelemetry >= TELEMETRY_INTERVAL && pendingTelemetry.isEmpty()) {
    lastTelemetry = now;
    JsonDocument event; envelope(event, "sensor.telemetry");
    event["enabled"] = enabled; event["version"] = version;
    event["present"] = present; event["distanceCm"] = roundf(distance * 10) / 10;
    event["studySeconds"] = studyTime / 1000;
    pendingTelemetry = encode(event);
  }
  delay(10);
}
