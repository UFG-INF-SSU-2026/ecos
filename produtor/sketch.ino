#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>

const int TRIG_PIN = 4;
const int ECHO_PIN = 2;
const int CAMERA_PIN = 14;
const int BOTAO_FALHA = 12;
const int LED_VERDE = 25;
const int LED_VERMELHO = 27;
const int BUZZER = 19;

const char* WIFI_SSID = "Wokwi-GUEST";
const char* WIFI_PASSWORD = "";
const char* API_URL = "https://ecos-ecmd.onrender.com/api/v1/eventos";

const unsigned long TEMPO_PAUSA = 10000;

unsigned long tempoEstudo = 0;
unsigned long ultimaAtualizacao = 0;
unsigned long sequenciaEvento = 0;

float medirDistancia() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long duracao = pulseIn(ECHO_PIN, HIGH, 30000);

  if (duracao == 0) {
    return -1;
  }

  return duracao * 0.0343 / 2.0;
}

bool cameraDetectaPessoa() {
  // Sensor de câmera: segundo sensor de presença. No protótipo, o sinal
  // já processado de detecção de pessoa é lido diretamente do pino
  // digital (HIGH = pessoa detectada, LOW = pessoa não detectada).
  return digitalRead(CAMERA_PIN) == HIGH;
}

void tocarAlerta() {
  tone(BUZZER, 1000);
  delay(1500);
  noTone(BUZZER);
}

bool reconectarWiFi() {
  Serial.println("Evento aguardando recuperacao da comunicacao...");

  while (digitalRead(BOTAO_FALHA) == LOW) {
    delay(500);
  }

  Serial.println("Falha encerrada.");
  Serial.println("Tentando recuperar a conexao Wi-Fi...");

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD, 6);

  unsigned long inicio = millis();

  while (WiFi.status() != WL_CONNECTED && millis() - inicio < 5000) {
    delay(500);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWi-Fi reconectado.");
    return true;
  }

  Serial.println("\nNao foi possivel recuperar a conexao.");
  return false;
}

void enviarEventoHTTP() {
  sequenciaEvento++;

  String eventId = "evt-" + String(sequenciaEvento);

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
    Serial.println("\nFALHA SIMULADA: comunicacao Wi-Fi indisponivel.");
    WiFi.disconnect();
    delay(500);
  }

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("FALHA DETECTADA: produtor sem conexao Wi-Fi.");

    if (!reconectarWiFi()) {
      Serial.println("Evento nao enviado.");
      return;
    }
  }

  Serial.println("Enviando evento para o consumidor...");

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;

  if (!http.begin(client, API_URL)) {
    Serial.println("FALHA DE COMUNICACAO: consumidor indisponivel.");
    return;
  }

  http.addHeader("Content-Type", "application/json");

  int codigoHTTP = http.POST(json);

  if (codigoHTTP >= 200 && codigoHTTP < 300) {
    Serial.print("SUCESSO - HTTP ");
    Serial.println(codigoHTTP);
    Serial.println(http.getString());
  } else {
    Serial.print("FALHA DE COMUNICACAO - HTTP ");
    Serial.println(codigoHTTP);
  }

  http.end();
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

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD, 6);

  Serial.print("Conectando ao Wi-Fi");

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("\nWi-Fi conectado.");

  ultimaAtualizacao = millis();
}

void loop() {
  unsigned long agora = millis();
  unsigned long intervalo = agora - ultimaAtualizacao;
  ultimaAtualizacao = agora;

  float distancia = medirDistancia();

  if (distancia < 0) {
    Serial.println("Leitura do sensor ultrassonico invalida.");
    delay(1000);
    return;
  }

  bool presencaUltrassonico = distancia < 80;
  bool presencaCamera = cameraDetectaPessoa();

  // Fusao dos sensores: a presenca so e confirmada quando os dois
  // sensores concordam. Isso reduz falsos positivos (ex.: ruido no
  // sensor ultrassonico) em relacao ao uso de um unico sensor.
  bool estudantePresente = presencaUltrassonico && presencaCamera;

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

      while (true) {
        delay(1000);
      }
    }
  } else {
    digitalWrite(LED_VERDE, LOW);
    digitalWrite(LED_VERMELHO, LOW);

    Serial.println("AUSENTE");
  }

  delay(1000);
}