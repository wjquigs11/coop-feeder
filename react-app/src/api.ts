// API client for the coop feeder device.
//
// The device exposes a small HTTP API (see docs/API.md at the repo root):
//   GET  /readings    -> JSON { loadcell: "72", units: "%", lastUpdate: "<ms>" }
//                        NOTE: all values are JSON strings, not numbers.
//   GET  /weight      -> plain text feed level (0-100)
//   POST /browsertime -> supply a wall-clock reference so lastUpdate is real
//
// React Native's networking does not support Server-Sent Events (the device's
// /events stream) reliably, so this client polls /readings instead.

/** A parsed reading from the feeder. */
export type Reading = {
  /** Feed level, 0-100. */
  level: number;
  /** Unit label for the level (e.g. "%"). */
  units: string;
  /** Timestamp of the reading in ms since epoch, or null if unknown. */
  lastUpdate: number | null;
};

/**
 * Turn user-entered text into a base URL.
 * Accepts things like "coopfeeder.local", "192.168.1.50",
 * "http://coopfeeder.local", or with a trailing slash / port.
 */
export function buildBaseUrl(hostname: string): string {
  let host = hostname.trim();
  if (host.length === 0) {
    throw new Error('Enter a feeder hostname or IP address.');
  }
  // Strip an existing scheme; we re-add http:// (the device serves plain HTTP).
  host = host.replace(/^https?:\/\//i, '');
  // Drop any trailing slashes.
  host = host.replace(/\/+$/, '');
  return `http://${host}`;
}

/** Fetch with a timeout so a bad host doesn't hang forever. */
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 5000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch and parse the current reading from the device. */
export async function fetchReading(baseUrl: string): Promise<Reading> {
  const res = await fetchWithTimeout(`${baseUrl}/readings`);
  if (!res.ok) {
    throw new Error(`Feeder responded with HTTP ${res.status}.`);
  }
  const raw = (await res.json()) as Record<string, unknown>;

  const levelNum = Number.parseInt(String(raw.loadcell ?? ''), 10);
  const level = Number.isFinite(levelNum) ? Math.max(0, Math.min(100, levelNum)) : 0;

  const units = raw.units != null ? String(raw.units) : '%';

  let lastUpdate: number | null = null;
  if (raw.lastUpdate != null) {
    const ts = Number.parseInt(String(raw.lastUpdate), 10);
    // The device may report millis()-since-boot before a time sync; treat
    // anything before 2020 as "not a real timestamp".
    lastUpdate = Number.isFinite(ts) && ts >= 1577836800000 ? ts : null;
  }

  return { level, units, lastUpdate };
}

/**
 * Run a load-cell calibration on the device via GET /config?empty or
 * GET /config?full. The device captures the current raw reading as the
 * empty/full reference. Returns the device's plain-text confirmation message.
 */
export async function calibrate(baseUrl: string, which: 'empty' | 'full'): Promise<string> {
  const res = await fetchWithTimeout(`${baseUrl}/config?${which}`);
  if (!res.ok) {
    throw new Error(`Calibration failed: HTTP ${res.status}.`);
  }
  return (await res.text()).trim();
}

/**
 * Send the current device (phone) time to the feeder so its lastUpdate becomes
 * a real Unix timestamp. Best-effort: failures are ignored by the caller.
 */
export async function sendBrowserTime(baseUrl: string): Promise<void> {
  const now = new Date();
  const body = JSON.stringify({
    timestamp: now.getTime(),
    timezone: 'UTC',
    offset: now.getTimezoneOffset(),
    localTime: now.toString(),
    isoString: now.toISOString(),
  });
  await fetchWithTimeout(`${baseUrl}/browsertime`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
}
