// BLE transport for the coop feeder.
//
// The feeder (ESP32/NimBLE firmware, src/ble.cpp) advertises a custom service
// with one Reading characteristic (READ + NOTIFY) whose value is the SAME
// readings JSON string the HTTP API returns. So this client just needs to get
// that string and hand it to parseReadingJson() — the gauge, low-feed alert,
// and persistence logic are all shared with the WiFi path via useFeeder.
//
// This is a short-range (~10 m) proximity link: it only works when the phone is
// near the coop. v1 is foreground-only. The scan-connect-read-once path
// (readOnce) is written to be reusable by a future background opportunistic
// scan task without changes here.
import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, State, type Device } from 'react-native-ble-plx';

import { readingFromLevel, type Reading } from './api';

// Must match the firmware (src/ble.cpp / src/include.h).
export const BLE_SERVICE_UUID = 'e3a1f6c0-2b7d-4c1a-9f3e-0a1b2c3d4e5f';
export const BLE_READING_CHAR_UUID = 'e3a1f6c1-2b7d-4c1a-9f3e-0a1b2c3d4e5f';

// How long to scan for the feeder before giving up (out of range / off).
const SCAN_TIMEOUT_MS = 8000;

// One shared manager for the whole app. Created lazily so merely importing this
// module doesn't spin up the BLE stack (and so a web build never touches it).
let manager: BleManager | null = null;
function getManager(): BleManager {
  if (!manager) manager = new BleManager();
  return manager;
}

/**
 * Request the runtime Bluetooth permissions needed to scan/connect. These are
 * declared in the manifest (via the react-native-ble-plx config plugin) but on
 * Android 12+ must also be granted at runtime, like the notifications prompt.
 *  - Android 12+ (API 31+): BLUETOOTH_SCAN + BLUETOOTH_CONNECT.
 *  - Android <=11 (API 30-): BLE scanning requires ACCESS_FINE_LOCATION.
 * No-op (resolves true) on iOS, where ble-plx triggers the system prompt itself.
 * Throws if the user denies, so the caller can surface a clear message.
 */
export async function ensureBlePermissions(): Promise<void> {
  if (Platform.OS !== 'android') return;

  const sdk = typeof Platform.Version === 'number' ? Platform.Version : parseInt(String(Platform.Version), 10);
  const needed =
    sdk >= 31
      ? [
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];

  const result = await PermissionsAndroid.requestMultiple(needed);
  const denied = needed.filter((p) => result[p] !== PermissionsAndroid.RESULTS.GRANTED);
  if (denied.length > 0) {
    throw new Error('Bluetooth permission denied. Enable it in app settings to connect.');
  }
}

/**
 * Make sure the device's Bluetooth adapter is actually powered on, so we give a
 * clear "turn on Bluetooth" message instead of a silent scan failure.
 */
async function ensureBluetoothOn(): Promise<void> {
  const mgr = getManager();
  const state = await mgr.state();
  if (state === State.PoweredOn) return;
  if (state === State.PoweredOff) {
    throw new Error('Bluetooth is turned off. Turn it on and try again.');
  }
  // Unknown/Resetting: wait briefly for it to settle to PoweredOn.
  await new Promise<void>((resolve, reject) => {
    const sub = mgr.onStateChange((s) => {
      if (s === State.PoweredOn) {
        sub.remove();
        resolve();
      } else if (s === State.PoweredOff || s === State.Unsupported) {
        sub.remove();
        reject(new Error('Bluetooth is not available on this device.'));
      }
    }, true);
    setTimeout(() => {
      sub.remove();
      reject(new Error('Bluetooth did not become ready.'));
    }, 5000);
  });
}

// The Reading characteristic carries a single byte: the feed level (0-100).
// ble-plx delivers characteristic values base64-encoded, so decode the first
// byte. One byte always fits a single BLE packet (no MTU negotiation needed).
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function decodeLevelByte(value: string | null | undefined): number {
  if (!value) throw new Error('Empty BLE characteristic value.');
  // Decode just the first base64 group (>= 2 chars) -> first output byte.
  const a = B64.indexOf(value[0]);
  const b = B64.indexOf(value[1]);
  if (a < 0 || b < 0) throw new Error('Malformed BLE characteristic value.');
  return ((a << 2) | (b >> 4)) & 0xff;
}

/**
 * Scan for the feeder advertising our service UUID and return the first match.
 * Rejects after SCAN_TIMEOUT_MS if nothing is found (e.g. out of range).
 */
async function scanForFeeder(): Promise<Device> {
  // Guard: runtime permissions and adapter power, with clear error messages.
  await ensureBlePermissions();
  await ensureBluetoothOn();

  const mgr = getManager();
  return new Promise<Device>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      mgr.stopDeviceScan();
      reject(new Error('No feeder found in Bluetooth range.'));
    }, SCAN_TIMEOUT_MS);

    mgr.startDeviceScan([BLE_SERVICE_UUID], null, (error, device) => {
      if (settled) return;
      if (error) {
        settled = true;
        clearTimeout(timer);
        mgr.stopDeviceScan();
        reject(error);
        return;
      }
      if (device) {
        settled = true;
        clearTimeout(timer);
        mgr.stopDeviceScan();
        resolve(device);
      }
    });
  });
}

async function connectAndDiscover(device: Device): Promise<Device> {
  const connected = await device.connect();
  await connected.discoverAllServicesAndCharacteristics();
  return connected;
}

/**
 * Read the Reading characteristic via the discovered characteristic OBJECT
 * (rather than the device.readCharacteristicForService helper), and log the raw
 * base64 so we can see exactly what ble-plx returns. Returns the base64 value.
 */
async function readReadingCharacteristic(device: Device): Promise<string | null> {
  const services = await device.services();
  const svc = services.find((s) => s.uuid.toLowerCase() === BLE_SERVICE_UUID);
  if (!svc) throw new Error('Feeder BLE service not found after connect.');
  const chars = await svc.characteristics();
  const ch = chars.find((c) => c.uuid.toLowerCase() === BLE_READING_CHAR_UUID);
  if (!ch) throw new Error('Feeder Reading characteristic not found.');
  const read = await ch.read();
  return read.value;
}

/**
 * Opportunistic single read: scan, connect, read the Reading characteristic
 * once, parse it, and disconnect. This is the path a future background task
 * will call when it wakes and the phone is near the coop. Throws if the feeder
 * is not in range or the read fails.
 */
export async function readOnce(): Promise<Reading> {
  const device = await scanForFeeder();
  let connected: Device | null = null;
  try {
    connected = await connectAndDiscover(device);
    const ch = await readReadingCharacteristic(connected);
    return readingFromLevel(decodeLevelByte(ch));
  } finally {
    // Always release the link; proximity reads should not hold a connection.
    if (connected) {
      await connected.cancelConnection().catch(() => {});
    }
  }
}

/** Stops a live subscription and drops the connection. */
export type BleSubscription = { stop: () => Promise<void> };

/**
 * Live stream: scan, connect, and subscribe to the Reading characteristic.
 * Calls onReading for each notification (and once immediately with the initial
 * read). Call the returned stop() to end the stream and disconnect. Used by the
 * foreground "connect via Bluetooth" flow.
 */
export async function subscribeReadings(
  onReading: (reading: Reading) => void,
  onError?: (error: Error) => void,
): Promise<BleSubscription> {
  const device = await scanForFeeder();
  const connected = await connectAndDiscover(device);

  // Seed with the current value so the UI populates before the first notify.
  try {
    const initial = await readReadingCharacteristic(connected);
    onReading(readingFromLevel(decodeLevelByte(initial)));
  } catch {
    // Non-fatal: notifications will populate shortly.
  }

  const monitor = connected.monitorCharacteristicForService(
    BLE_SERVICE_UUID,
    BLE_READING_CHAR_UUID,
    (error, ch) => {
      if (error) {
        onError?.(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      try {
        if (ch?.value) onReading(readingFromLevel(decodeLevelByte(ch.value)));
      } catch (e) {
        onError?.(e instanceof Error ? e : new Error(String(e)));
      }
    },
  );

  return {
    stop: async () => {
      monitor.remove();
      await connected.cancelConnection().catch(() => {});
    },
  };
}
