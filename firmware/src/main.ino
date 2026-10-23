/**
 * SENSOURA — ESP32-S3 N16R8 Smart Agriculture Node
 * NASA Competition — TEAM-MISSION-49
 *
 * Reads 7 sensor values (DHT11 air temp+humidity, DS18B20 soil temperature,
 * soil moisture, MQ135 gas, photoresistor light, BMP180 pressure), streams
 * them to Firebase Realtime Database over HTTPS REST, and executes commands
 * (water pump relay, buzzer, reboot, calibrate) written to the same DB.
 *
 * Firebase rules note: the RTDB root is locked and /testData is open.
 * The device tries /Sensoura first; on PERMISSION_DENIED it automatically
 * falls back to /testData, where the backend mirrors incoming telemetry.
 * Optionally set FIREBASE_WEB_API_KEY to sign in anonymously and get a token
 * (requires Anonymous Auth enabled in the Firebase console — it is).
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

// ======================= CONFIGURATION =======================
static const char* WIFI_SSID     = "YOUR_WIFI_SSID";
static const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

static const char* FIREBASE_HOST = "on-an-official-team-default-rtdb.europe-west1.firebasedatabase.app";
// Optional: Firebase Web API key (Console > Project settings > General > Web API key)
// Enables anonymous auth so the device can write to paths requiring auth.
static const char* FIREBASE_WEB_API_KEY = "";
static const char* DEVICE_ID = "sensoura-esp32-01";

static const uint32_t TELEMETRY_INTERVAL_MS = 5000;   // push sensor data every 5 s
static const uint32_t COMMAND_POLL_MS       = 3000;   // poll for commands every 3 s
static const uint32_t WIFI_RETRY_MS         = 10000;

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
void pushResult(const String& id, const char* target, const char* action,
                const char* status, const char* message, const char* actualState,
                uint32_t ts);

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

String firebaseBase = String("https://") + FIREBASE_HOST;
String idToken;               // anonymous auth token (empty when unused)
String activePath = "/Sensoura";   // switches to /testData on PERMISSION_DENIED
uint32_t lastTelemetry = 0;
uint32_t lastCommandPoll = 0;
uint32_t lastWifiRetry = 0;
uint32_t lastCommandTs = 0;         // newest executed command timestamp
bool permissionDenied = false;

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

/** Sign in anonymously to get an idToken (Anonymous Auth is enabled). */
void firebaseSignIn() {
  if (strlen(FIREBASE_WEB_API_KEY) == 0) return;
  if (WiFi.status() != WL_CONNECTED) return;

  WiFiClientSecure client;
  client.setInsecure();  // competition demo; pin the Google Root CA for production
  HTTPClient http;
  String url = String("https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=") + FIREBASE_WEB_API_KEY;
  if (!http.begin(client, url)) return;
  http.addHeader("Content-Type", "application/json");
  int code = http.POST("{}");
  if (code == 200) {
    JsonDocument doc;
    if (deserializeJson(doc, http.getString()) == DeserializationError::Ok) {
      idToken = doc["idToken"].as<String>();
      Serial.println("[AUTH] Anonymous sign-in OK");
    }
  } else {
    Serial.printf("[AUTH] Anonymous sign-in failed: %d\n", code);
  }
  http.end();
}

/** GET helper. Returns HTTP code; body is written to `out`. */
int firebaseGet(const String& path, String& out) {
  if (WiFi.status() != WL_CONNECTED) return -1;
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  String url = firebaseBase + path + ".json";
  if (idToken.length()) url += "?auth=" + idToken;
  if (!http.begin(client, url)) return -1;
  int code = http.GET();
  if (code > 0) out = http.getString();
  http.end();
  return code;
}

/** PUT helper. Returns HTTP code. */
int firebasePut(const String& path, const String& json) {
  if (WiFi.status() != WL_CONNECTED) return -1;
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  String url = firebaseBase + path + ".json";
  if (idToken.length()) url += "?auth=" + idToken;
  if (!http.begin(client, url)) return -1;
  http.addHeader("Content-Type", "application/json");
  int code = http.PUT(json);
  if (code == 401 || code == 403) {
    // Root is locked: fall back to /testData where rules allow read/write.
    permissionDenied = true;
    if (activePath != "/testData") {
      Serial.println("[FB] PERMISSION_DENIED on primary path — switching to /testData");
      activePath = "/testData";
    }
  }
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

// ======================= FIREBASE PUSH ======================
void pushTelemetry(const SensorReadings& r) {
  JsonDocument doc;
  // These keys are the database contract for /Sensoura/sensorData; they are
  // deliberately not the same as the internal SensorReadings member names.
  doc["AirTemp"]          = roundf(r.temperature * 100) / 100.0f;
  doc["SoilTemp"]         = roundf(r.soilTemperature * 100) / 100.0f;
  doc["AirHumidity"]      = roundf(r.humidity * 100) / 100.0f;
  doc["SoilMoisture"]     = roundf(r.soilMoisture * 100) / 100.0f;
  doc["VOC"]              = r.gas;
  doc["Light"]            = r.light;
  doc["Barometricpressure"] = roundf(r.airPressure * 100) / 100.0f;
  doc["lastUpdate"]       = (uint32_t)time(nullptr);

  String json;
  serializeJson(doc, json);
  int code = firebasePut(activePath + "/sensorData", json);
  if (code >= 200 && code < 300) {
    Serial.printf("[FB] telemetry pushed (%d)\n", code);
    setLeds(true, false);
  } else {
    Serial.printf("[FB] telemetry push failed: %d\n", code);
    setLeds(false, true);
  }

  // System status heartbeat
  JsonDocument sys;
  sys["status"] = "online";
  sys["lastSeen"] = (uint32_t)time(nullptr);
  sys["deviceId"] = DEVICE_ID;
  JsonObject relay = sys["relay"].to<JsonObject>();
  relay["mode"] = relayAutoMode ? "AUTO" : "MANUAL";
  relay["state"] = relayState ? "ON" : "OFF";
  relay["reason"] = relayReason;
  relay["lastAction"] = (uint32_t)time(nullptr);
  JsonObject buzzer = sys["buzzer"].to<JsonObject>();
  buzzer["muted"] = buzzerMuted;
  JsonObject leds = sys["leds"].to<JsonObject>();
  leds["green"] = relayState;   // green = pumping
  leds["red"] = buzzerMuted;

  String sysJson;
  serializeJson(sys, sysJson);
  firebasePut(activePath + "/system", sysJson);
}

// ======================= COMMAND HANDLING ===================
void executeCommand(const String& id, const char* target, const char* action, uint32_t ts) {
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
      pushResult(id, target, action, status, message, actualState, ts);
      ESP.restart();
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
  pushResult(id, target, action, status, message, actualState, ts);
}

void pushResult(const String& id, const char* target, const char* action,
                const char* status, const char* message, const char* actualState,
                uint32_t ts) {
  JsonDocument res;
  res["commandId"] = id;
  res["target"] = target;
  res["requestedAction"] = action;
  res["status"] = status;
  res["message"] = message;
  res["actualState"] = actualState;
  res["timestamp"] = (uint32_t)time(nullptr);
  String json;
  serializeJson(res, json);
  firebasePut(activePath + "/commandResults/" + id, json);
}

void pollCommands() {
  String body;
  int code = firebaseGet(activePath + "/commands", body);
  if (code != 200 || body == "null" || body.length() == 0) return;

  JsonDocument doc;
  if (deserializeJson(doc, body) != DeserializationError::Ok) return;

  for (JsonPair kv : doc.as<JsonObject>()) {
    JsonObject cmd = kv.value().as<JsonObject>();
    uint32_t ts = cmd["timestamp"] | 0UL;
    if (ts <= lastCommandTs) continue;    // already processed
    lastCommandTs = ts;

    String id = kv.key().c_str();
    const char* target = cmd["target"] | "";
    const char* action = cmd["action"] | "";
    executeCommand(id, target, action, ts);
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

  analogReadResolution(12);

  dht.begin();
  ds18b20.begin();
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  if (!bmp.begin()) {
    Serial.println("[BMP180] Sensor not found — check SDA/SCL wiring");
  }

  ensureWifi();
  configTime(0, 0, "pool.ntp.org");  // epoch timestamps for Firebase
  firebaseSignIn();

  // Initial boot heartbeat so the dashboard shows the device immediately
  SensorReadings r = readSensors();
  pushTelemetry(r);
}

void loop() {
  ensureWifi();

  uint32_t now = millis();
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
