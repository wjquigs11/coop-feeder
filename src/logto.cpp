#include <LittleFS.h>
#include "include.h"
#include "logto.h"

char logbuf[LOGBUF_SIZE];

extern bool serverStarted;
extern File consLog;

bool log::logToSerial = true;

#define CONSOLE_LOG_MAX 8192  // truncate when log exceeds this size

// Ring buffer for deferred file writes
static char ringBuf[LOG_RING_SIZE][LOG_LINE_MAX];
static volatile int ringHead = 0;  // next write position
static volatile int ringTail = 0;  // next read position

void log::toAll(const char* s) {
  if (logToSerial) {
    Serial.println(s);
#ifdef WEBSERIAL
    if (serverStarted) {
      WebSerial.println(s);
    }
#endif
    // Buffer the line for deferred file write
    int nextHead = (ringHead + 1) % LOG_RING_SIZE;
    if (nextHead != ringTail) {  // drop if buffer full
      strncpy(ringBuf[ringHead], s, LOG_LINE_MAX - 1);
      ringBuf[ringHead][LOG_LINE_MAX - 1] = '\0';
      ringHead = nextHead;
    }
  }
}

// Call from loop() to flush buffered lines to LittleFS
void log::flush() {
  if (!consLog) return;
  while (ringTail != ringHead) {
    consLog.println(ringBuf[ringTail]);
    ringTail = (ringTail + 1) % LOG_RING_SIZE;
  }
  consLog.flush();
}

bool log::initConsole(String conslogName) {
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
