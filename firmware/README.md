# SENSOURA Firmware — ESP32-S3 N16R8

Arduino/PlatformIO firmware for the SENSOURA smart-agriculture node (NASA Competition, TEAM-MISSION-49).

## Sensors (7 readings)

| Sensor            | Interface | Pin        | Reading                    |
| ----------------- | --------- | ---------- | -------------------------- |
| DHT11             | 1-wire   | GPIO4      | Air temperature + humidity |
| DS18B20           | 1-wire   | GPIO5      | Soil temperature           |
| Soil moisture     | ADC1     | GPIO6      | Soil moisture %            |
| MQ135             | ADC1     | GPIO7      | Gas (ppm index)            |
| Photoresistor     | ADC1     | GPIO1      | Light                      |
| BMP180            | I2C      | GPIO8/9    | Air pressure (hPa)         |

Actuators: relay/water pump (GPIO10, active LOW), buzzer (GPIO11), green LED (GPIO12), red LED (GPIO13).

> Analog sensors use **ADC1** pins only — ADC2 is unusable while Wi-Fi is active on the ESP32-S3.

## Configure

Edit the top of `src/main.ino`:

```cpp
static const char* WIFI_SSID     = "YOUR_WIFI_SSID";
static const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
// Optional: enables anonymous sign-in so /Sensoura (auth-required) is writable
static const char* FIREBASE_WEB_API_KEY = "";
```

## Flash

```bash
pio run -t upload --monitor
```

Or open this folder in VS Code + PlatformIO extension and click *Upload*.

## Firebase behavior

- Pushes `/Sensoura/sensorData` + `/Sensoura/system` every 5 s (HTTPS REST).
- Polls `/Sensoura/commands` every 3 s, executes pump/buzzer/reboot/calibrate,
  and writes results to `/Sensoura/commandResults/<id>`.
- The RTDB root is locked; if the device gets `PERMISSION_DENIED` it automatically
  switches to `/testData` (open read/write rules). The backend mirrors
  `/testData` telemetry into `/Sensoura` state, so the dashboard keeps working.
