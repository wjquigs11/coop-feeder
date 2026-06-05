#ifdef WEBSERIAL
#include <WiFi.h>
#include "include.h"
#include "logto.h"

/*
  Merged WebSerial + Serial console command handler for coop-feeder.
  Commands are dispatched from both WebSerial and the serial monitor via handleCommand().
  Call pollSerialConsole() from loop() to handle typed commands.
*/

// ─── Helpers ───────────────────────────────────────────────────────────────────

static String formatMacAddress(const String& macAddress) {
  String result = "{";
  int len = macAddress.length();
  for (int i = 0; i < len; i += 3) {
    if (i > 0) result += ", ";
    result += "0x" + macAddress.substring(i, i + 2);
  }
  result += "}";
  return result;
}

// ─── Command Dispatch ──────────────────────────────────────────────────────────

static const char* commandHelp =
  "commands: ?, restart, hostname, status, wifi, littlefs, conslog, "
  "toggle, timer, empty, full, note";

void handleCommand(String dataS) {
  dataS.trim();
  if (dataS.isEmpty()) return;

  // Tokenize
  String words[10];
  int wordCount = 0;
  int startIndex = 0, endIndex = 0;
  while (endIndex != -1 && wordCount < 10) {
    endIndex = dataS.indexOf(' ', startIndex);
    if (endIndex == -1)
      words[wordCount] = dataS.substring(startIndex);
    else
      words[wordCount] = dataS.substring(startIndex, endIndex);
    words[wordCount].trim();
    words[wordCount].toLowerCase();
    wordCount++;
    startIndex = endIndex + 1;
  }
  if (wordCount == 0) return;

  String cmd = words[0];

  // ─── General commands ──────────────────────────────────────────────────────

  if (cmd == "?") {
    log::toAll(commandHelp);
    return;
  }

  if (cmd == "restart") {
    log::toAll("restarting...");
    delay(100);
    ESP.restart();
  }

  if (cmd.startsWith("host")) {
    if (wordCount > 1 && words[1].length() > 0) {
      host = words[1];
      pendingHostname = host;
      pendingHostnameChange = true;
      pendingSaveToPrefs = true;
      snprintf(logbuf, LOGBUF_SIZE, "hostname set to %s (restart to apply)", host.c_str());
      log::toAll(logbuf);
    } else {
      snprintf(logbuf, LOGBUF_SIZE, "hostname: %s  ip: %s", host.c_str(), WiFi.localIP().toString().c_str());
      log::toAll(logbuf);
    }
    return;
  }

  if (cmd == "status") {
    unsigned long uptime = millis() / 1000;
    snprintf(logbuf, LOGBUF_SIZE, "uptime: %lu sec", uptime);
    log::toAll(logbuf);
    snprintf(logbuf, LOGBUF_SIZE, "hostname: %s  ip: %s", host.c_str(), WiFi.localIP().toString().c_str());
    log::toAll(logbuf);
    snprintf(logbuf, LOGBUF_SIZE, "WiFi: %s  RSSI: %d dBm",
      WiFi.status() == WL_CONNECTED ? "connected" : "disconnected", WiFi.RSSI());
    log::toAll(logbuf);
    snprintf(logbuf, LOGBUF_SIZE, "loadcell: %ld%%  raw: %ld", loadcell, LoadCell.is_ready() ? LoadCell.read() : 0L);
    log::toAll(logbuf);
    snprintf(logbuf, LOGBUF_SIZE, "empty_offset: %ld  full_raw: %ld", empty_offset, full_raw);
    log::toAll(logbuf);
    snprintf(logbuf, LOGBUF_SIZE, "timerDelay: %d ms", timerDelay);
    log::toAll(logbuf);
    snprintf(logbuf, LOGBUF_SIZE, "heap free: %u  min: %u", ESP.getFreeHeap(), ESP.getMinFreeHeap());
    log::toAll(logbuf);
    return;
  }

  if (cmd.startsWith("wifi")) {
    snprintf(logbuf, LOGBUF_SIZE, "hostname: %s  SSID: %s  ip: %s  MAC: %s",
      host.c_str(), WiFi.SSID().c_str(),
      WiFi.localIP().toString().c_str(), formatMacAddress(WiFi.macAddress()).c_str());
    log::toAll(logbuf);
    return;
  }

  if (cmd.startsWith("littlefs")) {
    if (wordCount > 1) {
      if (words[1] == "ls") {
        File root = LittleFS.open("/");
        File file = root.openNextFile();
        while (file) {
          snprintf(logbuf, LOGBUF_SIZE, "  %s (%d bytes)", file.name(), (int)file.size());
          log::toAll(logbuf);
          file.close();
          file = root.openNextFile();
        }
        root.close();
        return;
      }
      if (words[1] == "status") {
        size_t total = LittleFS.totalBytes(), used = LittleFS.usedBytes();
        snprintf(logbuf, LOGBUF_SIZE, "LittleFS: %u/%u bytes (%.1f%%)", (unsigned)used, (unsigned)total, 100.0f*used/total);
        log::toAll(logbuf);
        return;
      }
      if (words[1] == "read" && wordCount > 2) {
        String path = words[2];
        if (!path.startsWith("/")) path = "/" + path;
        File file = LittleFS.open(path);
        if (!file || file.isDirectory()) { log::toAll("failed to open"); return; }
        while (file.available()) {
          String line = file.readStringUntil('\n');
          log::toAll(line.c_str());
        }
        file.close();
        return;
      }
      if (words[1] == "rm" && wordCount > 2) {
        String path = words[2];
        if (!path.startsWith("/")) path = "/" + path;
        if (LittleFS.exists(path)) {
          if (LittleFS.remove(path))
            log::toAll("removed");
          else
            log::toAll("failed to remove");
        } else {
          log::toAll("not found");
        }
        return;
      }
      if (words[1] == "format") {
        LittleFS.format();
        log::toAll("LittleFS formatted");
        return;
      }
    }
    log::toAll("littlefs {ls|status|read <file>|rm <file>|format}");
    return;
  }

  if (cmd.startsWith("conslog")) {
    if (wordCount > 1 && words[1].startsWith("reset")) {
      extern File consLog;
      consLog.close();
      log::initConsole();
      log::toAll("console log reset");
    } else {
      File logFile = LittleFS.open("/console.log", "r");
      if (!logFile) { log::toAll("failed to open console log"); return; }
      const int maxLines = 20;
      String lineBuffer[maxLines];
      int lineCount = 0, bufferIndex = 0;
      while (logFile.available()) {
        lineBuffer[bufferIndex] = logFile.readStringUntil('\n');
        bufferIndex = (bufferIndex + 1) % maxLines;
        if (lineCount < maxLines) lineCount++;
      }
      for (int k = 0; k < lineCount; k++)
        log::toAll(lineBuffer[(bufferIndex + k) % maxLines].c_str());
      logFile.close();
    }
    return;
  }

  if (cmd.startsWith("tog")) {
    if (wordCount > 1 && words[1].startsWith("debu")) {
      // placeholder for debug toggle if needed
      log::toAll("debug toggle (no-op for feeder)");
    } else if (wordCount > 1 && words[1] == "log") {
      log::logToSerial = !log::logToSerial;
      snprintf(logbuf, LOGBUF_SIZE, "serial log: %s", log::logToSerial ? "on" : "off");
      log::toAll(logbuf);
    } else {
      log::toAll("toggle {debug|log}");
    }
    return;
  }

  if (cmd.startsWith("note")) {
    if (wordCount > 1)
      log::toAll(("note: " + words[1]).c_str());
    return;
  }

  // ─── App-specific commands (coop-feeder) ───────────────────────────────────

  if (cmd.startsWith("timer")) {
    if (wordCount > 1) {
      // argument is seconds, timerDelay is msec
      timerDelay = atoi(words[1].c_str()) * 1000;
      if (timerDelay < 200) timerDelay = 200;
      if (timerDelay > 60000) timerDelay = 60000;
      pendingTimerDelay = timerDelay;
      pendingTimerChange = true;
      pendingSaveToPrefs = true;
    }
    snprintf(logbuf, LOGBUF_SIZE, "timerDelay: %d ms", timerDelay);
    log::toAll(logbuf);
    return;
  }

  if (cmd.startsWith("empty")) {
    if (wordCount > 1) {
      if (words[1] == "?") {
        snprintf(logbuf, LOGBUF_SIZE, "empty calibration = %ld", empty_offset);
        log::toAll(logbuf);
      } else {
        empty_offset = atol(words[1].c_str());
        preferences.putLong("empty_offset", empty_offset);
        snprintf(logbuf, LOGBUF_SIZE, "empty offset set to %ld", empty_offset);
        log::toAll(logbuf);
      }
    } else {
      configTare("empty");
      log::toAll("empty calibration set");
    }
    return;
  }

  if (cmd.startsWith("full")) {
    if (wordCount > 1) {
      if (words[1] == "?") {
        snprintf(logbuf, LOGBUF_SIZE, "full offset = %ld", full_raw);
        log::toAll(logbuf);
      } else {
        long l = atol(words[1].c_str());
        if (l != 0) {
          full_raw = l;
          preferences.putLong("full_raw", full_raw);
          snprintf(logbuf, LOGBUF_SIZE, "full offset set to %ld", full_raw);
          log::toAll(logbuf);
        }
      }
    } else {
      configTare("full");
      log::toAll("full calibration set");
    }
    return;
  }

  snprintf(logbuf, LOGBUF_SIZE, "Unknown command: %s", cmd.c_str());
  log::toAll(logbuf);
}

// ─── Entry Points ──────────────────────────────────────────────────────────────

void WebSerialonMessage(uint8_t *data, size_t len) {
  snprintf(logbuf, LOGBUF_SIZE, "WebSerial: %u bytes", (unsigned)len);
  log::toAll(logbuf);
  String input = String((char*)data).substring(0, len);
  handleCommand(input);
}

// Call from loop() to handle commands typed in serial monitor
void pollSerialConsole() {
  static String serialBuf;
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      if (serialBuf.length() > 0) {
        handleCommand(serialBuf);
        serialBuf = "";
      }
    } else {
      serialBuf += c;
    }
  }
}

#endif
