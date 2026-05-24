// Fallback implementation when NETWIZARD is not defined
#ifdef WIFI
#ifndef NETWIZARD

#include "include.h"

// Debounce WiFi checks — transient disconnects shouldn't trigger reconnects
static unsigned long lastWifiDisconnect = 0;
static int wifiFailCount = 0;

void wifiCheck() {
  if (WiFi.status() == WL_CONNECTED) {
    wifiFailCount = 0;
    return;
  }
  
  // First disconnect: just note the time, don't react yet
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
    log::toAll("WiFi disconnected, attempt " + String(wifiFailCount) + "...");
    WiFi.reconnect();
    lastWifiDisconnect = millis();  // reset timer for next check
    return;
  }
  
  // Multiple soft reconnects failed — do a full reconnect
  log::toAll("WiFi reconnect failed, doing full reconnect...");
  wifiFailCount = 0;
  WiFi.disconnect(true);
  delay(100);
  setupWifi();
}

bool setupWifi() {
  Serial.println("Starting WiFi (fallback mode)...");
  
  // Default credentials in case file can't be read
  String ssid = "";
  String password = "";
  
  // Read WiFi credentials from JSON file
  if (LittleFS.exists("/wifi.json")) {
    File configFile = LittleFS.open("/wifi.json", "r");
    if (configFile) {
      Serial.println("Reading WiFi credentials from config file");
      
      // Parse JSON
      JsonDocument doc;
      DeserializationError error = deserializeJson(doc, configFile);
      configFile.close();
      
      if (!error) {
        ssid = doc["ssid"].as<String>();
        password = doc["password"].as<String>();
        Serial.println("WiFi credentials loaded successfully");
      } else {
        Serial.println("Failed to parse WiFi config file");
      }
    } else {
      Serial.println("Failed to open WiFi config file");
    }
  } else {
    Serial.println("WiFi config file not found");
  }
  
  if (ssid.length() == 0) {
    Serial.println("No SSID configured, cannot connect to WiFi");
    // Start AP so the TCP/IP stack is initialized for the web server
    WiFi.mode(WIFI_AP);
    WiFi.softAP(host.c_str());
    Serial.println("Started AP mode: " + host);
    Serial.println("AP IP: " + WiFi.softAPIP().toString());
    return false;
  }
  
  // Set WiFi to station mode
  WiFi.mode(WIFI_STA);
  
  // Try to connect to saved WiFi credentials
  WiFi.begin(ssid.c_str(), password.c_str());
  
  // Wait for connection with timeout
  int timeout = 20;
  while (WiFi.status() != WL_CONNECTED && timeout > 0) {
    delay(500);
    Serial.print(".");
    timeout--;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("");
    Serial.print("Connected to WiFi. IP address: ");
    Serial.println(WiFi.localIP());
    return true;
  } else {
    Serial.println("");
    Serial.println("Failed to connect to WiFi. Starting AP mode...");
    // Start AP so the TCP/IP stack is initialized for the web server
    WiFi.disconnect(true);
    WiFi.mode(WIFI_AP);
    WiFi.softAP(host.c_str());
    Serial.println("Started AP mode: " + host);
    Serial.println("AP IP: " + WiFi.softAPIP().toString());
    Serial.println("Format of the wifi.json file to put in LittleFS (/data):");
    Serial.println("{\n\t\"ssid\": \"your_SSID\",\n\t\"password\": \"your_password\"\n}");
    return false;
  }
}

void resetWifi() {
  Serial.println("Resetting WiFi settings (fallback mode)...");
  WiFi.disconnect(true); // Disconnect and delete credentials
  delay(1000);
  ESP.restart();
}

#endif // ifndef NETWIZARD
#endif