#include <Arduino.h>
#include <LittleFS.h>
#include <Preferences.h>

#ifdef WIFI
#include <WiFi.h>
#include <ArduinoJson.h>
#include <ESPmDNS.h>
#ifdef ELEGANTOTA_USE_ASYNC_WEBSERVER
#include <AsyncTCP.h>
#include <ESPAsyncWebServer.h>
extern AsyncWebServer server;
extern AsyncEventSource events;
#else
// not possible because there is no EventSource in non-async ESP32 WebServer library
#include <WebServer.h>
extern WebServer server;
//extern EventSource events;
#endif // ELEGANTOTA_USE_ASYNC_WEBSERVER
extern bool serverStarted;
extern bool wifiConnected;
extern unsigned long wifiStartTime;
extern String host;
extern JsonDocument readings;
extern int timerDelay;
#define HTTP_PORT 80
#define DRD_TIMEOUT 10
bool setupWifi();
void resetWifi();
void wifiCheck();
void startWebServer();
String getSensorReadings();

// WiFi credential handling (ported from 0-wifi-template)
#include <DNSServer.h>
#define DNS_INTERVAL 300
#define MAX_WIFI_NETWORKS 5
struct WiFiCredentials {
  String ssid;
  String password;
  String ip;
  String gateway;
};
extern WiFiCredentials wifi[];
extern int wifiCount;
extern bool gotWifiCreds;
extern DNSServer dnsServer;
extern TimerHandle_t connectTimer;
extern String newWifiSsid;
extern String newWifiPass;
void checkLittleFS();
bool readWiFiCredentials();
void startPortal();
void onWiFiConnected();
void onWiFiDisconnected();
void saveNewWifiCredentials(const char* ssid, const char* password);
void deleteWifiCredentials(const char* ssid);
#endif // ifdef WIFI

#ifdef BLE
// BLE (NimBLE) GATT interface. Mirrors the WiFi path: the feeder advertises a
// custom service and pushes the same getSensorReadings() JSON string as a
// notification on the Reading characteristic whenever a new reading is taken.
// UUIDs are random 128-bit; the app (react-app/src/ble.ts) must match these.
// NOTE: ble.cpp intentionally does NOT include this header (NimBLE's internal
// `struct log` collides with logto.h's `class log`), so it carries its OWN copy
// of these UUID macros — keep the two in sync. These copies document the
// contract for everything that includes include.h.
#define BLE_SERVICE_UUID        "e3a1f6c0-2b7d-4c1a-9f3e-0a1b2c3d4e5f"
#define BLE_READING_CHAR_UUID   "e3a1f6c1-2b7d-4c1a-9f3e-0a1b2c3d4e5f"
void setupBLE();
// Push the current getSensorReadings() JSON to subscribed clients (no-op if
// BLE isn't started or nobody is connected/subscribed).
void blePushReading();
#endif

#ifdef WEBSERIAL
#include <WebSerialPro.h>
void WebSerialonMessage(uint8_t *data, size_t len);
void handleCommand(String dataS);
void pollSerialConsole();
#endif
#ifdef ELEGANTOTA
#include <ElegantOTA.h>
#endif

#ifdef DEEPSLEEP
// Deep sleep: wake on a timer, stay awake awakeTimer seconds (long enough to
// take a reading and serve/advertise it), then sleep TIME_TO_SLEEP seconds.
#include <esp_sleep.h>
#define uS_TO_S_FACTOR 1000000ULL  // microseconds -> seconds
#define TIME_TO_SLEEP 300          // seconds asleep between wakes (5 min)
extern int awakeTimer;             // seconds to stay awake per wake cycle
extern int bootCount;              // persists across deep sleep (RTC_DATA_ATTR at definition)
void print_wakeup_reason();
#endif

#include "logto.h"

extern Preferences preferences;
extern File consLog;

// Deferred flash write flag — set in web handlers, consumed in loop()
extern volatile bool pendingSaveToPrefs;
// Pending preference values for deferred write
extern volatile bool pendingHostnameChange;
extern String pendingHostname;
extern volatile bool pendingTimerChange;
extern int pendingTimerDelay;

// weight value from load cell
extern long loadcell;
extern long empty_offset;
extern long full_raw;

void configTare(const String& type);

// Timer variables
#define DEFDELAY 1000
extern unsigned long lastTime;
extern int timerDelay;
extern int minReadRate;
// loopDelay: delay at end of each loop() iteration; raised to DNS_INTERVAL during captive portal
extern int loopDelay;
// global millis() snapshot, shared with wifi.cpp (wifiStartTime = now)
extern unsigned long now;
// store last update based on clock time from client browser
extern unsigned long lastUpdate, updateTime;

#include <HX711.h>
extern HX711 LoadCell;