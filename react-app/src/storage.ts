// AsyncStorage-backed persistence shared between the UI and the module-scope
// background task. The background task cannot touch React state, so it reads
// the configured hostname from here and writes back the latest reading; the
// screen reads that reading back when it mounts / regains focus.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Reading } from './api';

const KEY_HOSTNAME = 'coopfeeder.hostname';
const KEY_LAST_READING = 'coopfeeder.lastReading';
const KEY_WAS_LOW = 'coopfeeder.wasLow';

/** A reading plus the wall-clock time (ms) at which this app fetched it. */
export type StoredReading = Reading & { fetchedAt: number };

export async function saveHostname(hostname: string): Promise<void> {
  await AsyncStorage.setItem(KEY_HOSTNAME, hostname);
}

export async function loadHostname(): Promise<string | null> {
  return AsyncStorage.getItem(KEY_HOSTNAME);
}

export async function saveLastReading(reading: Reading): Promise<void> {
  const stored: StoredReading = { ...reading, fetchedAt: Date.now() };
  await AsyncStorage.setItem(KEY_LAST_READING, JSON.stringify(stored));
}

export async function loadLastReading(): Promise<StoredReading | null> {
  const raw = await AsyncStorage.getItem(KEY_LAST_READING);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredReading;
  } catch {
    return null;
  }
}

/**
 * Persisted "was below threshold" flag so the low-feed alert only fires on the
 * downward crossing, even across separate background task invocations (each of
 * which is a fresh JS context).
 */
export async function saveWasLow(wasLow: boolean): Promise<void> {
  await AsyncStorage.setItem(KEY_WAS_LOW, wasLow ? '1' : '0');
}

export async function loadWasLow(): Promise<boolean> {
  return (await AsyncStorage.getItem(KEY_WAS_LOW)) === '1';
}
