#include <LittleFS.h>
#include <time.h>  // time_t, struct tm, localtime_r for log timestamps
#include "include.h"
#include "logto.h"

char logbuf[LOGBUF_SIZE];

extern bool serverStarted;
extern File consLog;

bool log::logToSerial = true;

#define CONSOLE_LOG_MAX 8192  // truncate when log exceeds this size

// Thread-safe queue for deferred file writes. coop-feeder logs from multiple
// tasks (wifiConnectTask, FreeRTOS timer callbacks, loop()), so a plain ring
// buffer would race; the queue serializes concurrent producers safely.
static QueueHandle_t logQueue = NULL;

static void ensureQueue() {
  if (logQueue == NULL) {
    logQueue = xQueueCreate(LOG_RING_SIZE, LOG_LINE_MAX);
  }
}

void log::toAll(const char* s) {
  if (logToSerial) {
    Serial.println(s);
#ifdef WEBSERIAL
    if (serverStarted) {
      WebSerial.printf("%s\n", s);
    }
#endif
    // Buffer the line for deferred file write (with timestamp). Without NTP the
    // clock starts at boot, so this reads as HH:MM:SS elapsed since power-on;
    // once a time source is added it becomes wall-clock automatically.
    ensureQueue();
    if (logQueue) {
      char line[LOG_LINE_MAX];
      time_t now_t = time(nullptr);
      struct tm tm;
      localtime_r(&now_t, &tm);
      int offset = snprintf(line, LOG_LINE_MAX, "%02d:%02d:%02d ",
        tm.tm_hour, tm.tm_min, tm.tm_sec);
      strncpy(line + offset, s, LOG_LINE_MAX - offset - 1);
      line[LOG_LINE_MAX - 1] = '\0';
      xQueueSend(logQueue, line, 0);  // non-blocking, drops if full
    }
  }
}

// Call from loop() to flush buffered lines to LittleFS
void log::flush() {
  if (!consLog || !logQueue) return;
  char line[LOG_LINE_MAX];
  while (xQueueReceive(logQueue, line, 0) == pdTRUE) {
    consLog.println(line);
  }
  consLog.flush();
}

bool log::initConsole(String conslogName) {
  ensureQueue();

  // If log exists and is too large, delete it
  if (LittleFS.exists(conslogName)) {
    File f = LittleFS.open(conslogName, "r");
    if (f && f.size() > CONSOLE_LOG_MAX) {
      f.close();
      LittleFS.remove(conslogName);
      Serial.println("console.log truncated (size limit reached)");
    } else if (f) {
      f.close();
    }
  }

  // Create file if it doesn't exist
  if (!LittleFS.exists(conslogName)) {
    File f = LittleFS.open(conslogName, "w", true);
    if (!f) {
      Serial.println("initConsole: failed to create " + conslogName);
      return false;
    }
    f.close();
  }

  consLog = LittleFS.open(conslogName, "a");
  if (!consLog) return false;
  return consLog.println("ESP console log.") > 0;
}

// Logging bridge for src/ble.cpp. NimBLE's internal headers define a global
// `struct log` that collides with this project's `class log`, so ble.cpp cannot
// include logto.h (or include.h, which pulls it in). It calls this free
// function instead, which forwards to log::toAll here where `class log` is in
// scope and NimBLE's headers are not.
void bleLog(const char* s) {
  log::toAll(s);
}
