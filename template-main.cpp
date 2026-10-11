#include "include.h"

#ifdef REACT
using namespace reactesp;
ReactESP app;
#endif

Preferences preferences;
#ifdef DRD
bool doubleReset = false;
#endif
bool OTAinProgress = false;

unsigned long ota_progress_millis = 0;

unsigned long now;

void onOTAStart() {
  Serial.println("OTA update started!");
  OTAinProgress = true;
}

void onOTAProgress(size_t current, size_t final) {
  if (now - ota_progress_millis > 1000) {
    ota_progress_millis = now;
    Serial.printf("OTA Progress Current: %u bytes, Final: %u bytes\n", current, final);
  }
}

void onOTAEnd(bool success) {
  OTAinProgress = false;
  if (success) Serial.println("OTA update finished successfully!");
  else Serial.println("There was an error during OTA update!");
}

// host is used by both WiFi (mDNS, IP reporting) and the command console
// (hostname command), so it exists independently of the WIFI flag.
String host;
#ifdef WIFI
bool wifiEnabled = true;
bool wifiConnected = false;
unsigned long wifiStartTime = 0;
#else
bool wifiEnabled = false;
bool wifiConnected = false;
#endif

int timerDelay = 1000; // this sets loop time after housekeeping tasks are done
int loopDelay = 10;
time_t lastUpdate, updateTime;
unsigned long lastTime = 0;
unsigned long loopCount, maxLoopCount, webLoopCount;
struct tm *ptm;
char prbuf[PRBUF]; // PRBUF needs to be defined in include.h

#ifdef DEEPSLEEP
// Deep sleep variables
int awakeTimer = 300;  // stay awake for X seconds each time you wake up
// RTC memory variables (persist across deep sleep)
RTC_DATA_ATTR int bootCount = 0;

// Function to print the reason by which ESP32 has been awaken from sleep
void print_wakeup_reason() {
  esp_sleep_wakeup_cause_t wakeup_reason;
  wakeup_reason = esp_sleep_get_wakeup_cause();

  switch(wakeup_reason) {
    case ESP_SLEEP_WAKEUP_EXT0: log::toAll("Wakeup caused by external signal using RTC_IO"); break;
    case ESP_SLEEP_WAKEUP_EXT1: log::toAll("Wakeup caused by external signal using RTC_CNTL"); break;
    case ESP_SLEEP_WAKEUP_TIMER: log::toAll("Wakeup caused by timer"); break;
    case ESP_SLEEP_WAKEUP_TOUCHPAD: log::toAll("Wakeup caused by touchpad"); break;
    case ESP_SLEEP_WAKEUP_ULP: log::toAll("Wakeup caused by ULP program"); break;
    default:
      snprintf(logbuf, LOGBUF_SIZE, "Wakeup was not caused by deep sleep: %d", (int)wakeup_reason);
      log::toAll(logbuf);
      break;
  }
}
#else
int bootCount = 0;
#endif
unsigned long startTime; // Time when the device started

void setup() {
  Serial.begin(115200); 
  // temp 3 second delay
  delay(5000);
  startTime = millis();

  // Setup custom panic handler
  setup_custom_panic_handler();

  // Enable WiFi debugging
  //Serial.println("Enabling WiFi debugging...");
  //esp_log_level_set("wifi", ESP_LOG_VERBOSE);

  // Mount filesystem (needed for console log and WiFi credentials)
  if (LittleFS.begin(false, "/littlefs", 10, "littlefs")) {
    Serial.println("opened LittleFS");
  } else {
    Serial.println("failed to open LittleFS - trying format");
    if (LittleFS.begin(true, "/littlefs", 10, "littlefs")) {
      Serial.println("LittleFS formatted and mounted");
    } else {
      Serial.println("LittleFS mount failed even after format");
    }
  }

#ifdef WIFI
  checkLittleFS();
  gotWifiCreds = readWiFiCredentials();
#endif
  if (!log::initConsole()) {
    log::toAll("failed to open console log");
  } else {
    log::toAll("console log open");
  }

  // Increment boot number and print it every reboot
  ++bootCount;
  snprintf(logbuf, LOGBUF_SIZE, "Boot number: %d", bootCount);
  log::toAll(logbuf);

#ifdef DEEPSLEEP
  // Print the wakeup reason for ESP32
  print_wakeup_reason();

  // Configure the wake up source - set ESP32 to wake up every TIME_TO_SLEEP seconds
  esp_sleep_enable_timer_wakeup(TIME_TO_SLEEP * uS_TO_S_FACTOR);
  snprintf(logbuf, LOGBUF_SIZE, "Setup ESP32 to sleep for %d Seconds every %d seconds", TIME_TO_SLEEP, awakeTimer);
  log::toAll(logbuf);
#endif

  preferences.begin("ESPprefs", false);
  timerDelay = preferences.getInt("timerdelay", 10000);
  if (timerDelay<100) {
    timerDelay = 100;
    preferences.putInt("timerdelay", 100);
  }
  snprintf(logbuf, LOGBUF_SIZE, "timerDelay %d", timerDelay);
  log::toAll(logbuf);
  wifiEnabled = preferences.getBool("wifi", true);
  
#ifdef WIFI
  host = preferences.getString("hostname", "ESPmcu");
  snprintf(logbuf, LOGBUF_SIZE, "hostname: %s", host.c_str());
  log::toAll(logbuf);
#ifdef DRD
  doubleReset = preferences.getBool("DRD", false);
#endif
  if (wifiEnabled) {
#ifdef DRD
    if (doubleReset) {
      log::toAll("double reset detected - starting captive portal");
      preferences.putBool("DRD", false);
      doubleReset = false;
      preferences.end();
      startPortal(); // start immediately
      // Countdown: reboot if no client connects within DRD_TIMEOUT seconds
      // Freeze countdown if a client connects (user is configuring WiFi)
      int remaining = DRD_TIMEOUT;
      while (remaining > 0) {
        delay(1000);
        dnsServer.processNextRequest();
        if (WiFi.softAPgetStationNum() > 0) {
          // Client connected - freeze countdown, let portal run indefinitely
          Serial.println("DRD: client connected - portal active, waiting for config");
          while (true) {
            delay(10);
            dnsServer.processNextRequest();
          }
        }
        Serial.printf("DRD: no clients - rebooting in %d seconds (connect to ESP-SETUP to configure WiFi)\n", remaining);
        remaining--;
      }
      log::toAll("DRD: timeout with no clients - rebooting to normal WiFi mode");
      delay(500);
      ESP.restart();
    } else {
      // set up DRD flag - if another reboot happens within DRD_TIMEOUT, portal will open
      preferences.putBool("DRD", true);
#endif // DRD
      setupWifi(); // Async - will connect in background via event handlers
#ifdef WEB
      // Start the web server regardless of WiFi connection status
      // In fallback mode, it will serve from AP mode
      startWebServer();
      serverStarted = true;
#endif
#ifdef WEBSERIAL
      WebSerial.begin(&server);
      // Attach a callback function to handle incoming messages
      WebSerial.onMessage(WebSerialonMessage);
#endif
#ifdef ELEGANTOTA
      ElegantOTA.begin(&server);
      ElegantOTA.onStart(onOTAStart);
      ElegantOTA.onProgress(onOTAProgress);
      ElegantOTA.onEnd(onOTAEnd);
#endif
      // mDNS will be initialized by WiFi event handler when connected
#ifdef DRD
    }
#endif // DRD
  }
#endif // WIFI

  // app-specific setup can go here
#ifdef N2K
  setup_n2k();
#endif
  consLog.flush();

#ifdef REACT
#if defined(NTP)
  app.onRepeat(43200000, []() {
    // Get current time from NTP-synchronized system clock if available
    if (isNtpSyncSuccessful()) {
      // Use the NTP-synchronized time
      lastUpdate = getEpochTime();
    } else if (updateTime > 0) {
      // Fallback: Use the browser's timestamp as base and add elapsed milliseconds
      // TBD: fix
      lastUpdate = updateTime + now;
    } else {
      // If neither NTP nor browser time is available, use millis() as last resort
      // This will be incorrect since ESP32 millis() is not a Unix timestamp
      lastUpdate = now;
    }
  });
#endif // NTP  
  app.onRepeat(timerDelay, []() {
    //Serial.printf("%ld %ld %0.2f\n", loopCount, maxLoopCount, 1.0-((float)loopCount/(float)maxLoopCount));
    loopCount=0;
#if defined(WIFI) && defined(WEB)
    events.send(getSensorReadings().c_str(),"new_readings" ,now);
#endif // WIFI && WEB
  });
#endif // REACT
}

void loop() {
  now = millis();
  static unsigned long lastEventTime, lastTimeTime, startTime;
  loopCount++;
#ifdef DRD
  if (doubleReset) {
    static bool drdCleared = false;
    static unsigned long lastDrdLog = 0;
    // Clear DRD flag after DRD_TIMEOUT seconds for double reset detection
    // unless reset occurs within the timeout period
    if (!drdCleared) {
      int remaining = (DRD_TIMEOUT * 1000 - now) / 1000 + 1;
      if (remaining > 0 && (now - lastDrdLog >= 1000)) {
        snprintf(logbuf, LOGBUF_SIZE, "DRD: %ds remaining - reset again to trigger WIFI AP mode", remaining);
        log::toAll(logbuf);
        lastDrdLog = now;
      }
    }
    if (!drdCleared && (now > (DRD_TIMEOUT * 1000))) {
      preferences.putBool("DRD", false);
      drdCleared = true;
      doubleReset = false;
      log::toAll("DRD timeout - cleared double reset flag");
#if defined(WIFI) && defined(WEB)
      startWebServer();
      serverStarted = true;
#endif
#ifdef WEBSERIAL
      WebSerial.begin(&server);
      // Attach a callback function to handle incoming messages
      WebSerial.onMessage(WebSerialonMessage);
#endif    
    }
  } else {
#endif // DRD
    // no doubleReset
    if (!OTAinProgress) {
#ifdef REACT
      app.tick();
#endif
#ifdef N2K
      loop_n2k();  // pump the NMEA 2000 bus
#endif
      if (loopCount > maxLoopCount) maxLoopCount = loopCount;
      webLoopCount++;
#ifdef WEBSERIAL
      WebSerial.loop();
#endif
#if defined(CONSOLE) || defined(WEBSERIAL)
      pollSerialConsole();
#endif
#ifdef WIFI
      if (WiFi.getMode() == WIFI_AP || WiFi.getMode() == WIFI_AP_STA)
        dnsServer.processNextRequest(); // for captive portal
      // update web page
#endif
#ifdef ECHO
      if (Serial.available() > 0) {
        String input = "";
        while (Serial.available() > 0) {
          char c = Serial.read();
          if (c == '\n' || c == '\r') {
            // Ignore newline and carriage return characters
            break;
          }
          input += c;
        }
        if (input.length() > 0) {
          Serial.print("Received: ");
          Serial.println(input);
          if (input == "value") {
            // do something with serial input
            Serial.println("Value command received");
          }
        }
      }
#endif    
#ifdef DEEPSLEEP
      // Check if it's time to go to sleep
      if ((now - startTime) > (awakeTimer * 1000)) {
        log::toAll("Going to sleep in 5 seconds...");
        
        // Flush any pending data
        consLog.flush();
  #ifdef WEBSERIAL
        WebSerial.flush();
  #endif
        // Give time for final communications
        delay(5000);
        // Enter deep sleep
        snprintf(logbuf, LOGBUF_SIZE, "Entering deep sleep for %d seconds", TIME_TO_SLEEP);
        log::toAll(logbuf);
        esp_deep_sleep_start();
        // Code after this point will not be executed
      }
#endif
    } // !OTAinProgress
#ifdef DRD
  } // else no doubleReset
#endif // DRD
#ifdef ELEGANTOTA
  ElegantOTA.loop();
#endif
  //delay(loopDelay);
}
