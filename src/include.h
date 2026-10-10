#include <Arduino.h>
#include <LittleFS.h>
#include <Preferences.h>

#if defined(WIFI) || defined(NETWIZARD)
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

// WiFi credential handling (ported from 0-wifi-template, active when WIFI && !NETWIZARD)
#ifndef NETWIZARD
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
#endif // ifndef NETWIZARD
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
#ifdef NETWIZARD
#include <NetWizard.h>
extern NetWizard NW;
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