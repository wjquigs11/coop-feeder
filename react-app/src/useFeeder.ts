// Shared feeder connection/reading logic used by both the home screen (which
// displays the gauge) and the settings screen (which edits the hostname and
// connects). Keeping it in one hook avoids duplicating the connect/persist
// flow across screens.
import { useCallback, useState } from 'react';
import { Keyboard } from 'react-native';

import { buildBaseUrl, calibrate, fetchReading, sendBrowserTime, type Reading } from './api';
import { LOW_THRESHOLD, registerFeederBackgroundTask } from './backgroundTask';
import { ensureNotificationPermission, sendLowFeedAlert } from './notifications';
import {
  loadHostname,
  loadLastReading,
  loadWasLow,
  saveHostname,
  saveLastReading,
  saveWasLow,
  type StoredReading,
} from './storage';

export type Status = 'idle' | 'connecting' | 'connected' | 'error';

const DEFAULT_HOSTNAME = 'coopfeeder.local';

export function useFeeder() {
  const [hostname, setHostname] = useState(DEFAULT_HOSTNAME);
  const [status, setStatus] = useState<Status>('idle');
  const [reading, setReading] = useState<Reading | StoredReading | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Restore the saved hostname and last stored reading (e.g. from the
  // background task) so the gauge isn't blank. Safe to call repeatedly, such
  // as whenever the home screen regains focus.
  const reloadFromStorage = useCallback(async () => {
    const savedHost = await loadHostname();
    if (savedHost) setHostname(savedHost);
    const last = await loadLastReading();
    if (last) {
      setReading(last);
      setStatus('connected');
    }
  }, []);

  // Apply a fresh reading and persist it, firing the low-feed alert only on the
  // downward crossing below the threshold (the "was low" flag is persisted so
  // this stays consistent with the background task).
  const handleReading = useCallback(async (next: Reading) => {
    setReading(next);
    setStatus('connected');
    setErrorMessage(null);
    await saveLastReading(next);

    const isLow = next.level < LOW_THRESHOLD;
    const wasLow = await loadWasLow();
    if (isLow && !wasLow) {
      await sendLowFeedAlert(next.level);
    }
    await saveWasLow(isLow);
  }, []);

  // Connect to the given (or current) hostname: validate, persist, do one
  // immediate read, and ensure the daily background poll is registered.
  // Returns true on success. Ongoing updates come from the background task.
  const connect = useCallback(
    async (host: string = hostname): Promise<boolean> => {
      Keyboard.dismiss();

      let baseUrl: string;
      try {
        baseUrl = buildBaseUrl(host);
      } catch (err) {
        setStatus('error');
        setErrorMessage(err instanceof Error ? err.message : 'Invalid hostname.');
        return false;
      }

      setStatus('connecting');
      setErrorMessage(null);

      // Persist the hostname so the background task knows which feeder to poll.
      await saveHostname(host.trim());
      setHostname(host);

      // Ask for notification permission up front so the alert can fire later.
      await ensureNotificationPermission();

      // Best-effort: give the device a real clock reference.
      sendBrowserTime(baseUrl).catch(() => {});

      try {
        const first = await fetchReading(baseUrl);
        await handleReading(first);
        await registerFeederBackgroundTask();
        return true;
      } catch (err) {
        setStatus('error');
        setErrorMessage(err instanceof Error ? err.message : 'Could not reach the feeder.');
        return false;
      }
    },
    [hostname, handleReading],
  );

  // Run an empty/full calibration against the currently entered feeder.
  // Returns the device's confirmation message, or throws on failure.
  const calibrateFeeder = useCallback(
    async (which: 'empty' | 'full'): Promise<string> => {
      const baseUrl = buildBaseUrl(hostname);
      return calibrate(baseUrl, which);
    },
    [hostname],
  );

  return {
    hostname,
    setHostname,
    status,
    reading,
    errorMessage,
    connect,
    calibrateFeeder,
    reloadFromStorage,
  };
}
