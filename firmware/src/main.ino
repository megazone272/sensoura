/**
 * SENSOURA — ESP32-S3 N16R8 Smart Agriculture Node
 * NASA Competition — TEAM-MISSION-49
 *
 * Reads 7 sensor values (DHT11 air temp+humidity, DS18B20 soil temperature,
 * soil moisture, MQ135 gas, photoresistor light, BMP180 pressure), sends them
 * to the authenticated backend HTTPS API, and polls device-scoped commands.
 * Firebase service credentials and Realtime Database access remain server-side.
 * TLS certificate verification is mandatory; configure secrets.h with the
 * backend origin and trusted root CA before provisioning a device.
 *
 * Platform: PlatformIO (espressif32, arduino), board esp32-s3-devkitc-1 N16R8.
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <DHT.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <Adafruit_BMP085.h>
#include <ArduinoJson.h>
#include <string.h>
#include <time.h>
#include "secrets.h"

// ======================= CONFIGURATION =======================
static const char* WIFI_SSID = SENSOURA_WIFI_SSID;
static const char* WIFI_PASSWORD = SENSOURA_WIFI_PASSWORD;
static const char* API_BASE_URL = SENSOURA_API_BASE_URL;
static const char* DEVICE_ID = SENSOURA_DEVICE_ID;
static const char* DEVICE_AUTH_TOKEN = SENSOURA_DEVICE_AUTH_TOKEN;
static const char* API_ROOT_CA_PEM = SENSOURA_ROOT_CA_PEM;

static const uint32_t TELEMETRY_INTERVAL_MS = 5000;   // push sensor data every 5 s
static const uint32_t COMMAND_POLL_MS       = 3000;   // poll for commands every 3 s
static const uint32_t WIFI_RETRY_MS         = 10000;
static const uint32_t BACKEND_FAILSAFE_MS   = 60000;  // force pump OFF without an authenticated API response

// ======================= PIN MAP (ESP32-S3) ==================
#define PIN_DHT11        4
#define PIN_DS18B20      5
#define PIN_SOIL_MOIST   6    // ADC1_CH5
#define PIN_MQ135        7    // ADC1_CH6
#define PIN_PHOTO        1    // ADC1_CH0
#define PIN_I2C_SDA      8    // BMP180
#define PIN_I2C_SCL      9
#define PIN_RELAY        10   // water pump, active LOW
#define PIN_BUZZER       11
#define PIN_LED_GREEN    12
#define PIN_LED_RED      13

// ======================= SENSORS ============================
DHT dht(PIN_DHT11, DHT11);
OneWire oneWire(PIN_DS18B20);
DallasTemperature ds18b20(&oneWire);
Adafruit_BMP085 bmp;   // BMP180 compatible

// Forward declaration (used by executeCommand before its definition)
bool pushResult(const String& id, const char* target, const char* action,
                const char* status, const char* message, const char* actualState);

// ======================= STATE ==============================
struct SensorReadings {
  float temperature;      // DHT11 air temperature (°C)
  float soilTemperature;  // DS18B20 (°C)
  float humidity;         // DHT11 (%)
  float soilMoisture;     // 0..100 (%)
  uint16_t gas;           // MQ135 (ppm-ish raw)
  uint16_t light;         // photoresistor (raw)
  float airPressure;      // BMP180 (hPa)
  bool valid;
};

bool relayState = false;      // pump ON/OFF
bool buzzerMuted = false;
bool relayAutoMode = true;
const char* relayReason = "boot";

uint32_t lastTelemetry = 0;
uint32_t lastCommandPoll = 0;
uint32_t lastWifiRetry = 0;
uint32_t lastBackendSuccess = 0;

// ======================= HELPERS ============================
void setLeds(bool green, bool red) {
  digitalWrite(PIN_LED_GREEN, green ? HIGH : LOW);
  digitalWrite(PIN_LED_RED, red ? HIGH : LOW);
}

void setRelay(bool on, const char* reason) {
  relayState = on;
  relayReason = reason;
  digitalWrite(PIN_RELAY, on ? LOW : HIGH);  // active LOW relay module
  Serial.printf("[RELAY] Pump %s (%s)\n", on ? "ON" : "OFF", reason);
}

void setBuzzer(bool muted) {
  buzzerMuted = muted;
  digitalWrite(PIN_BUZZER, muted ? LOW : HIGH);
  Serial.printf("[BUZZER] %s\n", muted ? "MUTED" : "ACTIVE");
}

void ensureWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  uint32_t now = millis();
  if (now - lastWifiRetry < WIFI_RETRY_MS) return;
  lastWifiRetry = now;

  Serial.printf("[WIFI] Connecting to %s...\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
    delay(250);
    Serial.print('.');
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[WIFI] Connected, IP: %s\n", WiFi.localIP().toString().c_str());
    setLeds(true, false);
  } else {
    Serial.println("[WIFI] Connection failed, will retry");
    setLeds(false, true);
  }
}

uint64_t epochMillis() {
  const time_t now = time(nullptr);
  return now > 0 ? static_cast<uint64_t>(now) * 1000ULL : 0ULL;
}

String backendUrl(const char* path) {
  String url = API_BASE_URL;
  while (url.endsWith("/")) url.remove(url.length() - 1);
  url += path;
  return url;
}

bool configureTls(WiFiClientSecure& client) {
  if (strlen(API_ROOT_CA_PEM) < 100) {
    Serial.println("[TLS] Trusted root CA is missing; refusing backend connection");
    return false;
  }
  client.setCACert(API_ROOT_CA_PEM);
  return true;
}

void addDeviceAuthorization(HTTPClient& http) {
  http.addHeader("Authorization", String("Bearer ") + DEVICE_AUTH_TOKEN);
  http.addHeader("Content-Type", "application/json");
}

int backendGet(const char* path, String& out) {
  if (WiFi.status() != WL_CONNECTED) return -1;
  WiFiClientSecure client;
  if (!configureTls(client)) return -2;
  HTTPClient http;
  if (!http.begin(client, backendUrl(path))) return -1;
  addDeviceAuthorization(http);
  const int code = http.GET();
  if (code > 0) out = http.getString();
  if (code == 200) lastBackendSuccess = millis();
  http.end();
  return code;
}

bool isCommandResultAcknowledged(int statusCode, const String& responseBody) {
  if (statusCode < 200 || statusCode >= 300) return false;
  JsonDocument acknowledgement;
  if (deserializeJson(acknowledgement, responseBody) != DeserializationError::Ok) return false;
  return acknowledgement["success"].is<bool>() && acknowledgement["success"].as<bool>();
}

int backendPost(const char* path, const String& json, String* responseBody = nullptr) {
  if (WiFi.status() != WL_CONNECTED) return -1;
  WiFiClientSecure client;
  if (!configureTls(client)) return -2;
  HTTPClient http;
  if (!http.begin(client, backendUrl(path))) return -1;
  addDeviceAuthorization(http);
  const int code = http.POST(json);
  if (code > 0 && responseBody != nullptr) *responseBody = http.getString();
  if (code >= 200 && code < 300) lastBackendSuccess = millis();
  http.end();
  return code;
}

// ======================= SENSOR READINGS ====================
SensorReadings readSensors() {
  SensorReadings r{};

  float airT = dht.readTemperature();
  float hum = dht.readHumidity();
  if (!isnan(airT)) r.temperature = airT;
  if (!isnan(hum)) r.humidity = hum;

  ds18b20.requestTemperatures();
  float soilT = ds18b20.getTempCByIndex(0);
  if (soilT > -50) r.soilTemperature = soilT;

  // Soil moisture: calibrate with dry/wet extremes for your probe.
  int soilRaw = analogRead(PIN_SOIL_MOIST);
  r.soilMoisture = constrain(map(soilRaw, 3200, 1200, 0, 100), 0, 100);

  r.gas = (uint16_t)analogRead(PIN_MQ135);          // raw; backend treats it as ppm index
  r.light = (uint16_t)analogRead(PIN_PHOTO);
  r.airPressure = bmp.readPressure() / 100.0;       // Pa -> hPa

  r.valid = true;
  return r;
}

// ======================= BACKEND API TELEMETRY ======================
void pushTelemetry(const SensorReadings& r) {
  const uint64_t now = epochMillis();
  if (now == 0) {
    Serial.println("[API] System clock is not synchronized; refusing stale telemetry");
    setLeds(false, true);
    return;
  }

  JsonDocument doc;
  JsonObject sensor = doc["sensorData"].to<JsonObject>();
  sensor["AirTemp"] = roundf(r.temperature * 100) / 100.0f;
  sensor["SoilTemp"] = roundf(r.soilTemperature * 100) / 100.0f;
  sensor["AirHumidity"] = roundf(r.humidity * 100) / 100.0f;
  sensor["SoilMoisture"] = roundf(r.soilMoisture * 100) / 100.0f;
  sensor["VOC"] = r.gas;
  sensor["Light"] = r.light;
  sensor["Barometricpressure"] = roundf(r.airPressure * 100) / 100.0f;
  sensor["lastUpdate"] = now;

  JsonObject sys = doc["system"].to<JsonObject>();
  sys["status"] = "online";
  sys["lastSeen"] = now;
  sys["deviceId"] = DEVICE_ID;
  JsonObject relay = sys["relay"].to<JsonObject>();
  relay["mode"] = relayAutoMode ? "AUTO" : "MANUAL";
  relay["state"] = relayState ? "ON" : "OFF";
  relay["reason"] = relayReason;
  relay["lastAction"] = now;
  JsonObject buzzer = sys["buzzer"].to<JsonObject>();
  buzzer["muted"] = buzzerMuted;
  JsonObject leds = sys["leds"].to<JsonObject>();
  leds["green"] = relayState;
  leds["red"] = buzzerMuted;

  String json;
  serializeJson(doc, json);
  const int code = backendPost("/api/device/telemetry", json);
  if (code >= 200 && code < 300) {
    Serial.printf("[API] telemetry accepted (%d)\n", code);
    setLeds(true, false);
  } else {
    Serial.printf("[API] telemetry rejected/unavailable: %d\n", code);
    setLeds(false, true);
  }
}

// ======================= COMMAND HANDLING ===================
String pendingResultPath;
String pendingResultJson;
bool rebootAfterResult = false;

bool postPendingResult() {
  if (pendingResultJson.length() == 0) return true;
  const uint64_t now = epochMillis();
  if (now == 0) return false;
  JsonDocument pending;
  if (deserializeJson(pending, pendingResultJson) != DeserializationError::Ok) return false;
  pending["timestamp"] = now;
  pendingResultJson = "";
  serializeJson(pending, pendingResultJson);
  String responseBody;
  const int code = backendPost(pendingResultPath.c_str(), pendingResultJson, &responseBody);
  if (isCommandResultAcknowledged(code, responseBody)) {
    pendingResultPath = "";
    pendingResultJson = "";
    if (rebootAfterResult) {
      rebootAfterResult = false;
      ESP.restart();
    }
    return true;
  }
  return false;
}

bool pushResult(const String& id, const char* target, const char* action,
                const char* status, const char* message, const char* actualState) {
  JsonDocument res;
  res["commandId"] = id;
  res["target"] = target;
  res["requestedAction"] = action;
  res["status"] = status;
  res["message"] = message;
  res["actualState"] = actualState;
  res["timestamp"] = epochMillis();
  String json;
  serializeJson(res, json);
  const String path = String("/api/device/command-results/") + id;
  String responseBody;
  const int code = backendPost(path.c_str(), json, &responseBody);
  if (isCommandResultAcknowledged(code, responseBody)) return true;
  pendingResultPath = path;
  pendingResultJson = json;
  Serial.printf("[API] result pending retry: %d\n", code);
  return false;
}

void executeCommand(const String& id, const char* target, const char* action) {
  const char* status = "executed";
  const char* message = "OK";
  const char* actualState = "";

  if (strcmp(target, "pump") == 0) {
    if (strcmp(action, "ON") == 0) { setRelay(true, "manual"); actualState = "ON"; }
    else if (strcmp(action, "OFF") == 0) { setRelay(false, "manual"); actualState = "OFF"; }
    else { status = "failed"; message = "Unknown pump action"; actualState = relayState ? "ON" : "OFF"; }
  } else if (strcmp(target, "buzzer") == 0) {
    if (strcmp(action, "MUTE") == 0) { setBuzzer(true); actualState = "MUTED"; }
    else if (strcmp(action, "UNMUTE") == 0) { setBuzzer(false); actualState = "ACTIVE"; }
    else { status = "failed"; message = "Unknown buzzer action"; actualState = buzzerMuted ? "MUTED" : "ACTIVE"; }
  } else if (strcmp(target, "system") == 0) {
    if (strcmp(action, "REBOOT") == 0) {
      actualState = "REBOOTING";
      if (pushResult(id, target, action, status, message, actualState)) ESP.restart();
      rebootAfterResult = true;
      return;
    } else if (strcmp(action, "CALIBRATE") == 0) {
      actualState = "CALIBRATED";
      // Placeholder: capture dry/wet extremes here and persist to NVS.
    } else {
      status = "failed"; message = "Unknown system action"; actualState = "IDLE";
    }
  } else {
    status = "failed"; message = "Unknown target"; actualState = "N/A";
  }

  Serial.printf("[CMD] %s/%s -> %s (%s)\n", target, action, status, message);
  pushResult(id, target, action, status, message, actualState);
}

void pollCommands() {
  if (pendingResultJson.length() > 0) {
    postPendingResult();
    return;
  }
  if (epochMillis() == 0) return;

  String body;
  const int code = backendGet("/api/device/commands", body);
  if (code != 200 || body == "null" || body.length() == 0) return;

  JsonDocument doc;
  if (deserializeJson(doc, body) != DeserializationError::Ok) return;

  for (JsonPair kv : doc.as<JsonObject>()) {
    JsonObject cmd = kv.value().as<JsonObject>();
    const char* targetDeviceId = cmd["deviceId"] | "";
    if (strcmp(targetDeviceId, DEVICE_ID) != 0) continue;

    String id = kv.key().c_str();
    const char* target = cmd["target"] | "";
    const char* action = cmd["action"] | "";
    executeCommand(id, target, action);
    break;  // wait for the server to record this result before fetching another command
  }
}

// ======================= SETUP / LOOP =======================
void setup() {
  Serial.begin(115200);
  delay(1500);
  Serial.println("\n=== SENSOURA ESP32-S3 firmware v1.0.0 (TEAM-MISSION-49) ===");

  pinMode(PIN_RELAY, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_LED_GREEN, OUTPUT);
  pinMode(PIN_LED_RED, OUTPUT);
  setRelay(false, "boot");
  setBuzzer(false);
  setLeds(false, true);

  if (strlen(DEVICE_AUTH_TOKEN) < 32 || strstr(DEVICE_AUTH_TOKEN, "REPLACE_WITH")
      || strncmp(API_BASE_URL, "https://", 8) != 0
      || strstr(API_BASE_URL, "your-public-dashboard.example")
      || strstr(API_ROOT_CA_PEM, "REPLACE_WITH")) {
    Serial.println("[SECURITY] Replace the device token, HTTPS origin, and trusted root CA in secrets.h");
    while (true) {
      setRelay(false, "boot");
      setLeds(false, true);
      delay(1000);
    }
  }

  analogReadResolution(12);

  dht.begin();
  ds18b20.begin();
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  if (!bmp.begin()) {
    Serial.println("[BMP180] Sensor not found — check SDA/SCL wiring");
  }

  ensureWifi();
  configTime(0, 0, "pool.ntp.org");  // backend rejects stale or unsynchronized timestamps
  const uint32_t clockWaitStarted = millis();
  while (epochMillis() == 0 && millis() - clockWaitStarted < 15000) delay(500);
  if (epochMillis() == 0) Serial.println("[TIME] Clock unavailable; API telemetry and commands remain disabled");

  // Initial boot heartbeat so the dashboard shows the device immediately
  SensorReadings r = readSensors();
  pushTelemetry(r);
}

void loop() {
  ensureWifi();

  uint32_t now = millis();
  if ((lastBackendSuccess == 0 || now - lastBackendSuccess > BACKEND_FAILSAFE_MS) && relayState) {
    setRelay(false, "network-failsafe");
    setLeds(false, true);
  }

  if (now - lastTelemetry >= TELEMETRY_INTERVAL_MS) {
    lastTelemetry = now;
    SensorReadings r = readSensors();
    pushTelemetry(r);
  }

  if (now - lastCommandPoll >= COMMAND_POLL_MS) {
    lastCommandPoll = now;
    pollCommands();
  }

  // Buzzer alarm pattern while active and pump is off (gas warning hook)
  if (!buzzerMuted && !relayState) {
    digitalWrite(PIN_BUZZER, HIGH); delay(30);
    digitalWrite(PIN_BUZZER, LOW);  delay(970);
  }

  delay(50);
}
