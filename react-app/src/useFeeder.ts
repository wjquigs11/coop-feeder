// Shared feeder connection/reading logic used by both the home screen (which
// displays the gauge) and the settings screen (which edits the hostname and
// connects). Keeping it in one hook avoids duplicating the connect/persist
// flow across screens.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard } from 'react-native';

import { calibrate, fetchReading, resolveBaseUrl, sendBrowserTime, type Reading } from './api';
import { LOW_THRESHOLD, registerFeederBackgroundTask } from './backgroundTask';
import { subscribeReadings, type BleSubscription } from './ble';
import { ensureNotificationPermission, maybeAlertLowFeed } from './notifications';
import {
  loadHostname,
  loadLastBackgroundRun,
  loadLastReading,
  saveHostname,
  saveLastReading,
  type StoredReading,
} from './storage';

export type Status = 'idle' | 'connecting' | 'connected' | 'error';

const DEFAULT_HOSTNAME = 'coopfeeder.local';

export function useFeeder() {
  const [hostname, setHostname] = useState(DEFAULT_HOSTNAME);
  const [status, setStatus] = useState<Status>('idle');
  const [reading, setReading] = useState<Reading | StoredReading | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Wall-clock time (ms) of the last automatic background check, or null.
  const [lastBackgroundRun, setLastBackgroundRun] = useState<number | null>(null);
  // Foreground-refresh outcome, so a silent failure (device unreachable) is
  // visible instead of leaving a stale timestamp with no explanation.
  const [lastRefreshAttempt, setLastRefreshAttempt] = useState<number | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  // BLE (foreground live link) state. Separate from the WiFi status above.
  const [bleStatus, setBleStatus] = useState<Status>('idle');
  const [bleError, setBleError] = useState<string | null>(null);
  const bleSubRef = useRef<BleSubscription | null>(null);

  // Restore the saved hostname, last stored reading, and last background-run
  // time (e.g. from the background task) so the gauge isn't blank. Safe to call
  // repeatedly, such as whenever the home screen regains focus.
  const reloadFromStorage = useCallback(async () => {
    const savedHost = await loadHostname();
    if (savedHost) setHostname(savedHost);
    const last = await loadLastReading();
    if (last) {
      setReading(last);
      setStatus('connected');
    }
    setLastBackgroundRun(await loadLastBackgroundRun());
  }, []);

  // Apply a fresh reading and persist it. The low-feed alert decision is
  // delegated to the shared maybeAlertLowFeed() so the foreground and
  // background paths behave identically and don't fight over the same edge.
  const handleReading = useCallback(async (next: Reading) => {
    setReading(next);
    setStatus('connected');
    setErrorMessage(null);
    await saveLastReading(next);
    await maybeAlertLowFeed(next.level, LOW_THRESHOLD);
  }, []);

  // Connect to the given (or current) hostname: validate, persist, do one
  // immediate read, and ensure the daily background poll is registered.
  // Returns true on success. Ongoing updates come from the background task.
  const connect = useCallback(
    async (host: string = hostname): Promise<boolean> => {
      Keyboard.dismiss();

      if (host.trim().length === 0) {
        setStatus('error');
        setErrorMessage('Enter a feeder hostname or IP address.');
        return false;
      }

      setStatus('connecting');
      setErrorMessage(null);

      // Persist the hostname so the background task knows which feeder to poll.
      await saveHostname(host.trim());
      setHostname(host);

      // Ask for notification permission up front so the alert can fire later.
      await ensureNotificationPermission();

      try {
        // Resolve the host (mDNS .local -> IP) once, then reuse for both calls.
        const baseUrl = await resolveBaseUrl(host);
        // Best-effort: give the device a real clock reference.
        sendBrowserTime(baseUrl).catch(() => {});
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

  // Slim foreground refresh used when the app is opened / brought to the
  // foreground. Unlike connect(), it does not prompt for permissions, post the
  // browser time, or (re)register the background task — it just re-reads the
  // current level using the already-saved hostname. Silent no-op if no feeder
  // is configured or the device is unreachable, so opening the app never throws
  // the user into an error state; the last known reading stays on screen.
  const refreshFeeder = useCallback(async (): Promise<void> => {
    const savedHost = await loadHostname();
    if (!savedHost) return;

    setLastRefreshAttempt(Date.now());

    try {
      const baseUrl = await resolveBaseUrl(savedHost);
      const next = await fetchReading(baseUrl);
      await handleReading(next);
      setRefreshError(null);
    } catch (err) {
      // Keep the last known reading on screen, but record why the refresh
      // failed so the UI can show it instead of a misleading stale timestamp.
      setRefreshError(err instanceof Error ? err.message : 'Could not reach the feeder.');
    }
  }, [handleReading]);

  // Connect to the feeder over Bluetooth (foreground live link). Scans for the
  // feeder in range, subscribes to the Reading characteristic, and feeds each
  // notification through the same handleReading() path as WiFi, so the gauge
  // and low-feed alert work identically. Short-range: only succeeds when the
  // phone is near the coop. Returns true once subscribed.
  const connectBle = useCallback(async (): Promise<boolean> => {
    // Tear down any existing subscription first.
    if (bleSubRef.current) {
      await bleSubRef.current.stop().catch(() => {});
      bleSubRef.current = null;
    }
    setBleStatus('connecting');
    setBleError(null);
    // Ensure notification permission so a low reading over BLE can alert.
    await ensureNotificationPermission();
    try {
      const sub = await subscribeReadings(
        (next) => {
          handleReading(next).catch(() => {});
        },
        (err) => {
          setBleStatus('error');
          setBleError(err.message);
        },
      );
      bleSubRef.current = sub;
      setBleStatus('connected');
      return true;
    } catch (err) {
      setBleStatus('error');
      setBleError(err instanceof Error ? err.message : 'Could not connect over Bluetooth.');
      return false;
    }
  }, [handleReading]);

  // Stop the BLE live link and release the connection.
  const disconnectBle = useCallback(async (): Promise<void> => {
    if (bleSubRef.current) {
      await bleSubRef.current.stop().catch(() => {});
      bleSubRef.current = null;
    }
    setBleStatus('idle');
    setBleError(null);
  }, []);

  // Drop any live BLE link when the hook unmounts.
  useEffect(() => {
    return () => {
      if (bleSubRef.current) {
        bleSubRef.current.stop().catch(() => {});
        bleSubRef.current = null;
      }
    };
  }, []);

  // Run an empty/full calibration against the currently entered feeder.
  // Returns the device's confirmation message, or throws on failure.
  const calibrateFeeder = useCallback(
    async (which: 'empty' | 'full'): Promise<string> => {
      const baseUrl = await resolveBaseUrl(hostname);
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
    refreshFeeder,
    reloadFromStorage,
    lastBackgroundRun,
    lastRefreshAttempt,
    refreshError,
    connectBle,
    disconnectBle,
    bleStatus,
    bleError,
  };
}
