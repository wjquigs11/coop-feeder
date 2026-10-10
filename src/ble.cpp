// NimBLE GATT interface for the coop feeder.
//
// Mirrors the WiFi/SSE path: advertises a custom service with a single Reading
// characteristic (READ + NOTIFY) whose value is the same getSensorReadings()
// JSON string used by the web API. The app subscribes and receives a
// notification each time a new load-cell reading is taken (see blePushReading(),
// called from loop() alongside events.send()).
//
// NimBLE is used instead of Bluedroid because the firmware image (WiFi +
// ElegantOTA + WebSerialPro) is already large; NimBLE's footprint is much
// smaller. BLE and WiFi share the single 2.4GHz radio on the classic ESP32.
//
// IMPORTANT: this file deliberately does NOT include include.h / logto.h.
// NimBLE's internal porting layer defines a global `struct log` that collides
// with this project's `class log` (logto.h). To avoid that clash we include
// only the NimBLE + Arduino headers here and declare the few project symbols we
// need by hand, logging via the bleLog() bridge (implemented in logto.cpp).
//
// Read-only for now (Milestone 1); a Write command characteristic for
// calibration comes in a later milestone.

// Only build when BLE is enabled. We can't rely on include.h for the guard
// (see above), so test the build flag directly.
#ifdef BLE

#include <Arduino.h>
#include <NimBLEDevice.h>

// --- Project symbols declared by hand (normally from include.h) ---------
// Matched to the definitions in include.h; keep in sync.
#define BLE_SERVICE_UUID        "e3a1f6c0-2b7d-4c1a-9f3e-0a1b2c3d4e5f"
#define BLE_READING_CHAR_UUID   "e3a1f6c1-2b7d-4c1a-9f3e-0a1b2c3d4e5f"
extern String host;                 // configured device/mDNS hostname
extern String getSensorReadings();  // the readings JSON (defined in webserver.cpp)
extern void bleLog(const char* s);  // logging bridge (defined in logto.cpp)
static inline void bleLog(const String& s) { bleLog(s.c_str()); }

static NimBLEServer* bleServer = nullptr;
static NimBLECharacteristic* readingChar = nullptr;
static bool bleStarted = false;

// Track connection state so advertising restarts after a client disconnects,
// otherwise the feeder becomes undiscoverable once the first client drops.
class FeederServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer* /*server*/) override {
    bleLog("[BLE] client connected");
  }
  void onDisconnect(NimBLEServer* /*server*/) override {
    bleLog("[BLE] client disconnected; restarting advertising");
    NimBLEDevice::startAdvertising();
  }
};

void setupBLE() {
  // Advertise under the configured hostname so the app can find it by name.
  String devName = host.length() ? host : String("coopfeeder");

  NimBLEDevice::init(devName.c_str());
  // Modest TX power; this is a short-range proximity link by design.
  NimBLEDevice::setPower(ESP_PWR_LVL_P3);

  bleServer = NimBLEDevice::createServer();
  bleServer->setCallbacks(new FeederServerCallbacks());

  NimBLEService* service = bleServer->createService(BLE_SERVICE_UUID);
  readingChar = service->createCharacteristic(
    BLE_READING_CHAR_UUID,
    NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
  // Seed with the current reading so a client that reads on connect (before the
  // next notify) gets a valid value immediately, mirroring the SSE "send
  // current reading on connect" behaviour.
  readingChar->setValue(getSensorReadings().c_str());

  service->start();

  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  adv->addServiceUUID(BLE_SERVICE_UUID);
  adv->setScanResponse(true);
  NimBLEDevice::startAdvertising();

  bleStarted = true;
  bleLog("[BLE] advertising as " + devName);
}

void blePushReading() {
  if (!bleStarted || readingChar == nullptr) return;
  // Keep the readable value current even with no subscribers, then notify.
  String json = getSensorReadings();
  readingChar->setValue(json.c_str());
  readingChar->notify();
}

#endif // BLE
