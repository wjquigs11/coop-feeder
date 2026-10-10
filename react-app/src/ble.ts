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

import { parseReadingJson, type Reading } from './api';

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

// Strict base64 -> binary-string decoder. Only consumes valid base64 input;
// returns null if the input isn't well-formed base64 (so we can fall back to
// treating the value as an already-decoded string).
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64ToString(b64: string): string | null {
  const clean = b64.replace(/=+$/, '');
  // If any character is outside the base64 alphabet, it isn't base64.
  for (let i = 0; i < clean.length; i++) {
    if (B64.indexOf(clean[i]) < 0) return null;
  }
  let bits = 0;
  let acc = 0;
  let out = '';
  for (let i = 0; i < clean.length; i++) {
    acc = (acc << 6) | B64.indexOf(clean[i]);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((acc >> bits) & 0xff);
    }
  }
  return out;
}

/**
 * Decode a characteristic value into the readings JSON string.
 *
 * ble-plx is documented to deliver values base64-encoded, but behaviour has
 * varied across versions/platforms, so we're defensive: if the value already
 * looks like JSON (starts with '{'), use it as-is; otherwise base64-decode it;
 * if the decode doesn't yield JSON, fall back to the raw value. We also log the
 * raw/decoded forms so a mismatch is diagnosable from logcat.
 */
function decodeCharacteristic(value: string | null | undefined): string {
  if (!value) throw new Error('Empty BLE characteristic value.');

  const trimmed = value.trim();
  // Already-decoded JSON?
  if (trimmed.startsWith('{')) {
    console.log('[coopfeeder-ble] characteristic value was plain JSON');
    return trimmed;
  }

  const decoded = base64ToString(trimmed);
  if (decoded && decoded.trim().startsWith('{')) {
    return decoded.trim();
  }

  // Neither plain JSON nor base64-of-JSON — log both forms for diagnosis.
  console.log(
    `[coopfeeder-ble] unrecognized characteristic value. raw="${value}" decoded="${decoded ?? '(not base64)'}"`,
  );
  // Best effort: return whatever we have so the error names the real content.
  return decoded ?? trimmed;
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
    const ch = await connected.readCharacteristicForService(
      BLE_SERVICE_UUID,
      BLE_READING_CHAR_UUID,
    );
    return parseReadingJson(decodeCharacteristic(ch.value));
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
    const initial = await connected.readCharacteristicForService(
      BLE_SERVICE_UUID,
      BLE_READING_CHAR_UUID,
    );
    onReading(parseReadingJson(decodeCharacteristic(initial.value)));
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
        if (ch?.value) onReading(parseReadingJson(decodeCharacteristic(ch.value)));
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
