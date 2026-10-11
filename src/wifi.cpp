// Full WiFi handling for coop-feeder, ported from 0-wifi-template.
// Features: multi-SSID, async non-blocking connect, captive portal,
// pre-connect scan, lastSSID priority, and gateway-reachability health check.
// Active when WIFI is defined.
#ifdef WIFI
/*
Start wifi. If there are credentials saved in a file, use them.
If not, start a captive portal (using DNS).
*/
#include "include.h"

bool gotWifiCreds = false;
const char* wifiPath = "/wifi.json";

WiFiCredentials wifi[MAX_WIFI_NETWORKS];
int wifiCount = 0;

// Staging area for webserial wifi add (set ssid and pass separately, save when both present)
String newWifiSsid;
String newWifiPass;

TimerHandle_t connectTimer = NULL;
static int connectIdx = 0;
static int connectCount = 0;
#define RETRY_PER_SSID 3

// Flag for wifiConnectTask to poll
static volatile bool wifiConnectPending = false;

// Track which wifi[] entries were seen in the initial scan (index matches wifi[])
static bool wifiVisible[MAX_WIFI_NETWORKS];

bool littleFSDebug = false;

// check LittleFS even if wifi is not enabled
void checkLittleFS() {
  size_t totalBytes = LittleFS.totalBytes();
  size_t usedBytes = LittleFS.usedBytes();
  Serial.print("LittleFS Total space: ");
  Serial.print(totalBytes);
  Serial.println(" bytes");
  Serial.print("LittleFS Used space: ");
  Serial.print(usedBytes);
  Serial.println(" bytes");
  Serial.print("LittleFS Free space: ");
  Serial.print(totalBytes - usedBytes);
  Serial.println(" bytes");
  float usedPercentage = ((float)usedBytes / totalBytes) * 100;
  Serial.print("LittleFS Usage: ");
  Serial.print(usedPercentage);
  Serial.println("%");
  File root = LittleFS.open("/");
  File file = root.openNextFile();
  Serial.println("Files on LittleFS:");
  while (file) {
    Serial.print("  ");
    Serial.print(file.name());
    Serial.print(" - ");
    Serial.print(file.size());
    Serial.println(" bytes");
    file = root.openNextFile();
  }
}

// Read WiFi credentials from wifi.json file
bool readWiFiCredentials() {
  File file = LittleFS.open(wifiPath, "r");
  if (!file) {
      Serial.println("Failed to open wifi.json");

      if (!LittleFS.exists(wifiPath)) {
          Serial.println("Error: wifi.json does not exist");
      }
      else if (file.isDirectory()) {
          Serial.println("Error: Path is a directory, not a file");
      }
      else if (!LittleFS.begin()) {
          Serial.println("Error: LittleFS not mounted");
      }
      else if (LittleFS.totalBytes() == 0) {
          Serial.println("Error: LittleFS has no space");
      }
      else {
          Serial.println("Error: Unknown file open error (corruption/permissions?)");
      }
      return false;
  }

  // Parse JSON array from file
  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, file);
  file.close();

  if (error) {
    snprintf(logbuf, LOGBUF_SIZE, "Failed to parse wifi.json: %s", error.c_str());
    log::toAll(logbuf);
    return false;
  }

  JsonArray arr = doc.as<JsonArray>();
  wifiCount = 0;

  for (JsonObject obj : arr) {
    if (wifiCount >= MAX_WIFI_NETWORKS) break;

    if (!obj["ssid"].is<const char*>()) continue;

    wifi[wifiCount].ssid = obj["ssid"].as<String>();
    wifi[wifiCount].password = obj["password"] | "";
    wifi[wifiCount].ip = obj["ip"] | "";
    wifi[wifiCount].gateway = obj["gateway"] | "";

    snprintf(logbuf, LOGBUF_SIZE, "WiFi[%d] - SSID: %s, Password length: %d, IP: %s, Gateway: %s",
      wifiCount, wifi[wifiCount].ssid.c_str(), (int)wifi[wifiCount].password.length(),
      wifi[wifiCount].ip.c_str(), wifi[wifiCount].gateway.c_str());
    log::toAll(logbuf);

    wifiCount++;
  }

  if (wifiCount > 0) {
    snprintf(logbuf, LOGBUF_SIZE, "Loaded %d WiFi network(s)", wifiCount);
    log::toAll(logbuf);
    return true;
  }

  log::toAll("No valid WiFi credentials found in wifi.json");
  return false;
}

// for captive portal
DNSServer dnsServer;

// Search for parameter in HTTP POST request
const char* PARAM_HOSTNAME = "hostname";
const char* PARAM_SSID = "ssid";
const char* PARAM_PASSWORD = "pass";
const char* PARAM_IP = "ip";
const char* PARAM_GATEWAY = "gateway";

void setUpDNSServer(DNSServer &dnsServer, const IPAddress &localIP) {
  // Set the TTL for DNS response and start the DNS server
  log::toAll("starting DNS server for captive portal");
  dnsServer.setTTL(3600);
  dnsServer.start(53, "*", localIP);
  // we modify loop() delay here; not sure if this is necessary
  loopDelay = DNS_INTERVAL;
}

void startPortal() {
    // Connect to Wi-Fi network with SSID and password
    log::toAll("Setting AP (Access Point)");
    // NULL sets an open Access Point
    WiFi.softAP("ESP-SETUP", NULL);

    IPAddress IP = WiFi.softAPIP();
    snprintf(logbuf, LOGBUF_SIZE, "AP IP address: %s", IP.toString().c_str());
    log::toAll(logbuf);

    setUpDNSServer(dnsServer, IP);
  String localIPURL = "http://" + IP.toString();

  // https://github.com/CDFER/Captive-Portal-ESP32
  //======================== Webserver ========================
  // WARNING IOS (and maybe macos) WILL NOT POP UP IF IT CONTAINS THE WORD "Success" https://www.esp8266.com/viewtopic.php?f=34&t=4398
  // SAFARI (IOS) IS STUPID, G-ZIPPED FILES CAN'T END IN .GZ https://github.com/homieiot/homie-esp8266/issues/476 this is fixed by the webserver serve static function.
  // SAFARI (IOS) there is a 128KB limit to the size of the HTML. The HTML can reference external resources/images that bring the total over 128KB
  // SAFARI (IOS) popup browser has some severe limitations (javascript disabled, cookies disabled)

  // Required
  server.on("/connecttest.txt", [](AsyncWebServerRequest *request) { request->redirect("http://logout.net"); });  // windows 11 captive portal workaround
  server.on("/wpad.dat", [](AsyncWebServerRequest *request) { request->send(404); });                // Honestly don't understand what this is but a 404 stops win 10 keep calling this repeatedly and panicking the esp32 :)

  // Background responses: Probably not all are Required, but some are. Others might speed things up?
  // A Tier (commonly used by modern systems)
  server.on("/generate_204", [localIPURL](AsyncWebServerRequest *request) { request->redirect(localIPURL); });       // android captive portal redirect
  server.on("/redirect", [localIPURL](AsyncWebServerRequest *request) { request->redirect(localIPURL); });           // microsoft redirect
  server.on("/hotspot-detect.html", [localIPURL](AsyncWebServerRequest *request) { request->redirect(localIPURL); });  // apple call home
  server.on("/canonical.html", [localIPURL](AsyncWebServerRequest *request) { request->redirect(localIPURL); });     // firefox captive portal call home
  server.on("/success.txt", [](AsyncWebServerRequest *request) { request->send(200); });                   // firefox captive portal call home
  server.on("/ncsi.txt", [localIPURL](AsyncWebServerRequest *request) { request->redirect(localIPURL); });           // windows call home

  // return 404 to webpage icon
  server.on("/favicon.ico", [](AsyncWebServerRequest *request) { request->send(404); });  // webpage icon

  // the catch all
  server.onNotFound([localIPURL](AsyncWebServerRequest *request) {
    snprintf(logbuf, LOGBUF_SIZE, "CAPTIVE PORTAL onNotFound: %d %s %s -> redirecting",
      (int)request->method(), request->host().c_str(), request->url().c_str());
    log::toAll(logbuf);
    request->redirect(localIPURL);
  });

  // Web Server Root URL: serve wifimanager.html from captive portal
  server.on("/", HTTP_GET, [](AsyncWebServerRequest *request){
      request->send(LittleFS, "/wifimanager.html", "text/html");
  });

  // Return list of saved SSIDs as JSON array
  server.on("/wifilist", HTTP_GET, [](AsyncWebServerRequest *request) {
    String json = "[";
    for (int i = 0; i < wifiCount; i++) {
      if (i > 0) json += ",";
      json += "\"";
      json += wifi[i].ssid;
      json += "\"";
    }
    json += "]";
    request->send(200, "application/json", json);
  });

  // Delete selected SSIDs
  server.on("/wifidelete", HTTP_POST, [](AsyncWebServerRequest *request) {
    int params = request->params();
    int deleted = 0;
    for (int i = 0; i < params; i++) {
      const AsyncWebParameter* p = request->getParam(i);
      if (p->isPost() && p->name() == "ssid") {
        deleteWifiCredentials(p->value().c_str());
        deleted++;
      }
    }
    snprintf(logbuf, LOGBUF_SIZE, "Deleted %d SSID(s) via web", deleted);
    log::toAll(logbuf);
    request->send(200, "text/plain", "OK");
  });

  server.on("/wifimanager", HTTP_POST, [](AsyncWebServerRequest *request) {
      String ssid, password, ip, gateway;
      int params = request->params();
      for (int i=0; i<params; i++) {
        const AsyncWebParameter* p = request->getParam(i);
        if(p->isPost()) {
          if (p->name() == PARAM_HOSTNAME && p->value().length() > 0) {
            // hostname is special; goes into preferences instead of file
            host = p->value().c_str();
            preferences.putString("hostname", host);
            snprintf(logbuf, LOGBUF_SIZE, "host set to: %s", host.c_str());
            log::toAll(logbuf);
          }
          if (p->name() == PARAM_SSID) {
            ssid = p->value().c_str();
            snprintf(logbuf, LOGBUF_SIZE, "SSID set to: %s", ssid.c_str());
            log::toAll(logbuf);
          }
          if (p->name() == PARAM_PASSWORD) {
            password = p->value().c_str();
            snprintf(logbuf, LOGBUF_SIZE, "Password set to: %s", password.c_str());
            log::toAll(logbuf);
          }
          if (p->name() == PARAM_IP) {
            ip = p->value().c_str();
            snprintf(logbuf, LOGBUF_SIZE, "IP Address set to: %s", ip.c_str());
            log::toAll(logbuf);
          }
          if (p->name() == PARAM_GATEWAY) {
            gateway = p->value().c_str();
            snprintf(logbuf, LOGBUF_SIZE, "Gateway set to: %s", gateway.c_str());
            log::toAll(logbuf);
          }
          snprintf(logbuf, LOGBUF_SIZE, "POST[%s]: %s", p->name().c_str(), p->value().c_str());
          log::toAll(logbuf);
        }
      }
      if (ssid.length() > 0 && password.length() > 0) {
        // Save the WiFi credentials to the JSON file
        // Read existing JSON array first
        JsonDocument doc;
        JsonArray arr;

        if (LittleFS.exists(wifiPath)) {
          File readFile = LittleFS.open(wifiPath, FILE_READ);
          if (readFile) {
            DeserializationError error = deserializeJson(doc, readFile);
            readFile.close();
            if (error) {
              doc.clear();
            }
          }
        }
        arr = doc.is<JsonArray>() ? doc.as<JsonArray>() : doc.to<JsonArray>();

        // Create new entry and insert at beginning (newest first)
        JsonDocument newEntry;
        newEntry["ssid"] = ssid;
        newEntry["password"] = password;
        if (ip.length() > 0) newEntry["ip"] = ip;
        if (gateway.length() > 0) newEntry["gateway"] = gateway;

        // Shift existing entries and insert new one at front
        JsonDocument newDoc;
        JsonArray newArr = newDoc.to<JsonArray>();
        newArr.add(newEntry);
        for (JsonVariant v : arr) {
          newArr.add(v);
        }

        File file = LittleFS.open(wifiPath, FILE_WRITE);
        if (!file) {
          log::toAll("Failed to open wifi.json for writing");
        } else {
          serializeJsonPretty(newDoc, file);
          file.close();
          log::toAll("WiFi credentials saved to wifi.json (newest first)");
        }
      } else
        log::toAll("must supply ssid and password");
    request->send(200, "text/plain", "Done. ESP will restart, connect to your router and go to IP address: " + ip);
    delay(3000);
    ESP.restart();
  }); // end lambda for "/"

  server.begin();
}

// WiFi event handlers
void onWiFiConnected() {
  log::toAll("WiFi connected!");
  snprintf(logbuf, LOGBUF_SIZE, "ESP IP Address: http://%s", WiFi.localIP().toString().c_str());
  log::toAll(logbuf);
  wifiConnected = true;

  // Store the successfully connected SSID for next boot priority
  String connectedSSID = WiFi.SSID();
  if (connectedSSID.length() > 0) {
    preferences.putString("lastSSID", connectedSSID);
    snprintf(logbuf, LOGBUF_SIZE, "Stored lastSSID: %s", connectedSSID.c_str());
    log::toAll(logbuf);
  }
  if (connectTimer != NULL) {
    xTimerDelete(connectTimer, 0);
    connectTimer = NULL;
  }

  // Initialize mDNS
  String mdnsHost = host;
  mdnsHost.toLowerCase();
  mdnsHost.replace("_", "-");
  mdnsHost.replace(" ", "-");
  String sanitized = "";
  for (int i = 0; i < (int)mdnsHost.length() && i < 63; i++) {
    char c = mdnsHost.charAt(i);
    if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-') {
      sanitized += c;
    }
  }
  if (sanitized.length() > 0) {
    MDNS.end();  // clean up any previous mDNS state
    snprintf(logbuf, LOGBUF_SIZE, "Starting MDNS with hostname: %s", sanitized.c_str());
    log::toAll(logbuf);
    if (!MDNS.begin(sanitized.c_str())) {
      log::toAll("Error starting MDNS responder");
    } else {
      snprintf(logbuf, LOGBUF_SIZE, "MDNS started successfully as %s.local", sanitized.c_str());
      log::toAll(logbuf);
      if (!MDNS.addService("http", "tcp", HTTP_PORT)) {
        log::toAll("MDNS add service failed");
      } else {
        log::toAll("MDNS service added successfully");
      }
    }
  }
  // NOTE: the app web server (startWebServer() in webserver.cpp) owns server.begin()
  // for STA mode and is started once from setup(); we do not re-begin it here.
}

static int disConCount = 0;
void onWiFiDisconnected() {
  disConCount++;
  snprintf(logbuf, LOGBUF_SIZE, "WiFi disconnected disconnect count: %d", disConCount);
  log::toAll(logbuf);
  wifiConnected = false;
}

// ─── WiFi health check ─────────────────────────────────────────────────────────
// Periodically verifies gateway reachability and forces reconnect if the WiFi
// stack is dead (connected but no actual network path).

static unsigned long lastGatewayCheck = 0;
static unsigned long lastGatewaySuccess = 0;
static const unsigned long GATEWAY_CHECK_INTERVAL = 60000;   // check every 60s
static const unsigned long GATEWAY_TIMEOUT = 300000;         // 5 min with no response = dead

// Debounce WiFi disconnect — transient glitches shouldn't trigger reconnect
static unsigned long lastWifiDisconnect = 0;
static int wifiFailCount = 0;

void wifiCheck() {
  if (WiFi.status() == WL_CONNECTED) {
    wifiFailCount = 0;

    // Periodic gateway reachability check using TCP connect to port 1
    // (any port works — we just need to confirm the TCP/IP stack can reach the gateway)
    unsigned long now_ms = millis();
    if (now_ms - lastGatewayCheck >= GATEWAY_CHECK_INTERVAL) {
      lastGatewayCheck = now_ms;
      IPAddress gw = WiFi.gatewayIP();
      if (gw) {
        WiFiClient testClient;
        testClient.setTimeout(1);
        // connect() returns true if TCP handshake completes OR we get a RST
        // (both prove network reachability). Only a timeout means dead.
        bool reachable = testClient.connect(gw, 1);
        testClient.stop();
        if (reachable || lastGatewaySuccess == 0) {
          lastGatewaySuccess = now_ms;
        }
      }
    }

    // If gateway unreachable for too long, force reconnect
    if (lastGatewaySuccess > 0 && (now_ms - lastGatewaySuccess >= GATEWAY_TIMEOUT)) {
      log::toAll("WiFi stack dead (gateway unreachable), forcing reconnect...");
      lastGatewaySuccess = now_ms;  // reset to avoid rapid retries
      WiFi.disconnect(true);
      delay(100);
      WiFi.mode(WIFI_STA);
      WiFi.begin(wifi[0].ssid, wifi[0].password);
    }
    return;
  }

  // Not connected — debounce before reacting
  if (wifiFailCount == 0) {
    lastWifiDisconnect = millis();
    wifiFailCount = 1;
    return;
  }

  // Wait 5 seconds before deciding it's a real disconnect
  if (millis() - lastWifiDisconnect < 5000) {
    return;
  }

  // Still disconnected after 5s — try a soft reconnect first
  if (wifiFailCount < 3) {
    wifiFailCount++;
    snprintf(logbuf, LOGBUF_SIZE, "WiFi disconnected, attempt %d...", wifiFailCount);
    log::toAll(logbuf);
    WiFi.reconnect();
    lastWifiDisconnect = millis();  // reset timer for next check
    return;
  }

  // Multiple soft reconnects failed — do a full reconnect
  log::toAll("WiFi reconnect failed, doing full reconnect...");
  wifiFailCount = 0;
  WiFi.disconnect(true);
  delay(100);
  WiFi.mode(WIFI_STA);
  WiFi.begin(wifi[0].ssid, wifi[0].password);
}

// Task function that calls WiFi.begin() with its own stack.
// Spawned from the timer callback so the timer daemon task is never burdened
// with the heavy WiFi stack work.
static void doWiFiBeginTask(void* param) {
  int idx = (int)param;
  WiFi.begin(wifi[idx].ssid, wifi[idx].password);
  vTaskDelete(NULL); // self-delete when done
}

// Dedicated task for WiFi connection attempts
// Runs with 4096 bytes stack to handle logging and String operations
static void wifiConnectTask(void* param) {
  for (;;) {
    if (wifiConnectPending) {
      wifiConnectPending = false;

      if (wifiConnected) {
        log::toAll("Already connected, stopping connection attempts");
        xTimerStop(connectTimer, 0);
        continue;
      }

      // Skip any SSIDs not seen in the initial scan
      while (connectIdx < wifiCount && !wifiVisible[connectIdx]) {
        snprintf(logbuf, LOGBUF_SIZE, "Skipping %s (not visible in scan)", wifi[connectIdx].ssid.c_str());
        log::toAll(logbuf);
        connectCount = 0;
        connectIdx++;
      }
      if (connectIdx >= wifiCount) {
        log::toAll("Failed to connect to any WiFi network, starting captive portal");
        xTimerDelete(connectTimer, 0);
        connectTimer = NULL;
        WiFi.disconnect(true);
        WiFi.mode(WIFI_OFF);
        delay(100);
        startPortal();
        continue;
      }

      snprintf(logbuf, LOGBUF_SIZE, "connecting to: %s attempt: %d/%d",
        wifi[connectIdx].ssid.c_str(), connectCount + 1, RETRY_PER_SSID);
      log::toAll(logbuf);

      // Spawn a dedicated task for WiFi.begin() so the timer daemon stack is not
      // overflowed by the WiFi stack internals (4096 bytes is sufficient headroom).
      xTaskCreate(doWiFiBeginTask, "wifiBegin", 4096, (void*)connectIdx, 1, NULL);

      if (++connectCount >= RETRY_PER_SSID) {
        connectCount = 0;
        connectIdx++;
        if (connectIdx >= wifiCount) {
          log::toAll("Failed to connect to any WiFi network, starting captive portal");
          xTimerDelete(connectTimer, 0);
          connectTimer = NULL;
          WiFi.disconnect(true);
          WiFi.mode(WIFI_OFF);
          delay(100);
          startPortal();
          continue;
        }
        snprintf(logbuf, LOGBUF_SIZE, "Moving to next SSID: %s", wifi[connectIdx].ssid.c_str());
        log::toAll(logbuf);
      }
    }
    vTaskDelay(pdMS_TO_TICKS(100)); // Check every 100ms
  }
}

void tryConnect(TimerHandle_t xTimer) {
  // Just set the flag - the actual work is done in wifiConnectTask
  // This keeps the timer callback minimal and avoids timer daemon stack overflow
  wifiConnectPending = true;
}

bool setupWifi() {
  log::toAll("Starting WiFi...");
  // Set up WiFi event handlers
  WiFi.onEvent([](WiFiEvent_t event, WiFiEventInfo_t info) {
    onWiFiConnected();
  }, ARDUINO_EVENT_WIFI_STA_GOT_IP);

  WiFi.onEvent([](WiFiEvent_t event, WiFiEventInfo_t info) {
    onWiFiDisconnected();
  }, ARDUINO_EVENT_WIFI_STA_DISCONNECTED);

  if (!gotWifiCreds) {
    log::toAll("No wifi credentials in wifi.json, starting captive portal...");
    startPortal();
    return false;
  } else {
    log::toAll("starting wifi");

    // Prioritize lastSSID from Preferences — move it to front of wifi[] array
    String lastSSID = preferences.getString("lastSSID", "");
    if (lastSSID.length() > 0) {
      int foundIdx = -1;
      for (int i = 0; i < wifiCount; i++) {
        if (wifi[i].ssid == lastSSID) {
          foundIdx = i;
          break;
        }
      }
      if (foundIdx > 0) {
        // Swap to front so it's tried first
        WiFiCredentials tmp = wifi[0];
        wifi[0] = wifi[foundIdx];
        wifi[foundIdx] = tmp;
        snprintf(logbuf, LOGBUF_SIZE, "Prioritizing lastSSID: %s", lastSSID.c_str());
        log::toAll(logbuf);
      } else if (foundIdx == 0) {
        snprintf(logbuf, LOGBUF_SIZE, "lastSSID already first: %s", lastSSID.c_str());
        log::toAll(logbuf);
      } else {
        snprintf(logbuf, LOGBUF_SIZE, "lastSSID '%s' not in wifi.json, ignoring", lastSSID.c_str());
        log::toAll(logbuf);
      }
    }

    WiFi.mode(WIFI_STA);

    // Scan for available networks and mark which of our saved SSIDs are visible.
    // SSIDs not present in the scan are skipped during connection attempts.
    log::toAll("Scanning for available WiFi networks...");
    int scanCount = WiFi.scanNetworks();
    if (scanCount > 0) {
      snprintf(logbuf, LOGBUF_SIZE, "Scan found %d network(s)", scanCount);
      log::toAll(logbuf);
      for (int i = 0; i < wifiCount; i++) {
        wifiVisible[i] = false;
        for (int s = 0; s < scanCount; s++) {
          if (wifi[i].ssid == WiFi.SSID(s)) {
            wifiVisible[i] = true;
            snprintf(logbuf, LOGBUF_SIZE, "  %s: visible (%d dBm)", wifi[i].ssid.c_str(), WiFi.RSSI(s));
            log::toAll(logbuf);
            break;
          }
        }
        if (!wifiVisible[i]) {
          snprintf(logbuf, LOGBUF_SIZE, "  %s: not visible, will skip", wifi[i].ssid.c_str());
          log::toAll(logbuf);
        }
      }
    } else {
      // Scan failed or found nothing — mark all visible so we still attempt every SSID
      snprintf(logbuf, LOGBUF_SIZE, "Scan returned %d, will try all saved SSIDs", scanCount);
      log::toAll(logbuf);
      for (int i = 0; i < wifiCount; i++) {
        wifiVisible[i] = true;
      }
    }
    WiFi.scanDelete();  // free scan result memory

    wifiStartTime = now; // Set global wifiStartTime when WiFi connection starts
    // set up tryConnect every 5 seconds
    // pdTRUE means auto-reload (periodic timer)
    connectTimer = xTimerCreate("connectTimer", 5000/portTICK_PERIOD_MS, pdTRUE, NULL, tryConnect);
    if (connectTimer == NULL) {
      log::toAll("Failed to create wifi connect timer");
      return false;
    }
    xTimerStart(connectTimer,0);
    log::toAll("WiFi connection initiated (async)...");

    // Start the wifiConnectTask to handle connection attempts
    xTaskCreate(wifiConnectTask, "wifiConnect", 4096, NULL, 1, NULL);
    log::toAll("WiFi connect task started");

    return false; // Not connected yet, will be set by event handler
  }
}

void resetWifi() {
  log::toAll("Resetting WiFi settings...");
  WiFi.disconnect(true);
  if (LittleFS.exists(wifiPath))
    if (LittleFS.remove(wifiPath))
      log::toAll("removed wifi params");
  delay(3000);
  ESP.restart();
}

// Save new credentials as first entry in wifi.json, preserving existing entries
void saveNewWifiCredentials(const char* ssid, const char* password) {
  // Read existing JSON array first
  JsonDocument doc;
  JsonArray arr;

  if (LittleFS.exists(wifiPath)) {
    File readFile = LittleFS.open(wifiPath, FILE_READ);
    if (readFile) {
      DeserializationError error = deserializeJson(doc, readFile);
      readFile.close();
      if (error) {
        doc.clear();
      }
    }
  }
  arr = doc.is<JsonArray>() ? doc.as<JsonArray>() : doc.to<JsonArray>();

  // Create new entry and insert at beginning (newest first), removing any existing entry with same SSID
  JsonDocument newEntry;
  newEntry["ssid"] = ssid;
  newEntry["password"] = password;

  JsonDocument newDoc;
  JsonArray newArr = newDoc.to<JsonArray>();
  newArr.add(newEntry);
  for (JsonVariant v : arr) {
    if (v["ssid"].as<String>() != String(ssid)) {
      newArr.add(v);
    }
  }

  File file = LittleFS.open(wifiPath, FILE_WRITE);
  if (!file) {
    log::toAll("Failed to open wifi.json for writing");
    return;
  }
  serializeJsonPretty(newDoc, file);
  file.close();
  snprintf(logbuf, LOGBUF_SIZE, "Saved new WiFi: %s (first in wifi.json)", ssid);
  log::toAll(logbuf);

  // Reload credentials and reconnect
  readWiFiCredentials();
  gotWifiCreds = true;
  wifiFailCount = 0;  // prevent wifiCheck() from also reconnecting
  WiFi.disconnect(true);
  delay(100);
  connectIdx = 0;
  connectCount = 0;

  // Mark all SSIDs visible — the user just added one, so bypass the stale scan
  // filter and let the connect task attempt every saved network.
  for (int i = 0; i < wifiCount; i++) {
    wifiVisible[i] = true;
  }

  // Restart the connect timer so it cycles through SSIDs
  if (connectTimer != NULL) {
    xTimerDelete(connectTimer, 0);
    connectTimer = NULL;
  }
  connectTimer = xTimerCreate("connectTimer", 5000/portTICK_PERIOD_MS, pdTRUE, NULL, tryConnect);
  if (connectTimer != NULL) {
    xTimerStart(connectTimer, 0);
  }

  wifiConnectPending = true;
  snprintf(logbuf, LOGBUF_SIZE, "Reconnecting to %s...", ssid);
  log::toAll(logbuf);
}

// Delete a WiFi credential by SSID from wifi.json and reload
void deleteWifiCredentials(const char* ssid) {
  if (!LittleFS.exists(wifiPath)) {
    log::toAll("wifi.json not found");
    return;
  }

  // Read existing JSON array
  JsonDocument doc;
  File readFile = LittleFS.open(wifiPath, FILE_READ);
  if (!readFile) {
    log::toAll("Failed to open wifi.json for reading");
    return;
  }
  DeserializationError error = deserializeJson(doc, readFile);
  readFile.close();

  if (error) {
    snprintf(logbuf, LOGBUF_SIZE, "Failed to parse wifi.json: %s", error.c_str());
    log::toAll(logbuf);
    return;
  }

  JsonArray arr = doc.as<JsonArray>();
  bool found = false;

  // Build new array without the matching SSID
  JsonDocument newDoc;
  JsonArray newArr = newDoc.to<JsonArray>();
  for (JsonObject obj : arr) {
    const char* entrySsid = obj["ssid"] | "";
    if (strcmp(entrySsid, ssid) == 0) {
      found = true;
      continue; // skip this entry
    }
    newArr.add(obj);
  }

  if (!found) {
    snprintf(logbuf, LOGBUF_SIZE, "SSID '%s' not found in wifi.json", ssid);
    log::toAll(logbuf);
    return;
  }

  // Rewrite file without the deleted entry
  File writeFile = LittleFS.open(wifiPath, FILE_WRITE);
  if (!writeFile) {
    log::toAll("Failed to open wifi.json for writing");
    return;
  }
  serializeJsonPretty(newDoc, writeFile);
  writeFile.close();

  snprintf(logbuf, LOGBUF_SIZE, "Deleted WiFi: %s", ssid);
  log::toAll(logbuf);

  // Reload credentials
  readWiFiCredentials();
  gotWifiCreds = (wifiCount > 0);
}
#endif // ifdef WIFI
