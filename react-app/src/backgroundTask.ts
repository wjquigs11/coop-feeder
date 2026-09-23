// Background task that wakes roughly once a day to poll the feeder.
//
// IMPORTANT: TaskManager.defineTask must run at module/global scope (not inside
// a React component) so the task is registered whenever the JS bundle loads —
// including when the OS relaunches the app to run the task in the background.
// Importing this module (e.g. from the root layout) is enough to define it.
import * as BackgroundTask from 'expo-background-task';
import * as Network from 'expo-network';
import * as TaskManager from 'expo-task-manager';

import { fetchReading, resolveBaseUrl } from './api';
import { sendLowFeedAlert } from './notifications';
import {
  appendBackgroundLog,
  loadHostname,
  loadWasLow,
  saveLastBackgroundRun,
  saveLastReading,
  saveWasLow,
} from './storage';

export const FEEDER_BACKGROUND_TASK = 'coopfeeder-poll';

// expo-background-task uses minutes; the OS treats this as a MINIMUM and picks
// the actual run time. WorkManager's practical floor is 15 minutes.
// In development we use a short interval so the worker can be observed firing
// without waiting a full day; production polls about once a day.
const PROD_INTERVAL_MINUTES = 24 * 60;
const DEV_INTERVAL_MINUTES = 15;
const INTERVAL_MINUTES = __DEV__ ? DEV_INTERVAL_MINUTES : PROD_INTERVAL_MINUTES;

export const LOW_THRESHOLD = 10;

/** Log to both the device console (visible in `adb logcat`) and persistent storage. */
async function bgLog(message: string): Promise<void> {
  // The "[coopfeeder-bg]" prefix makes it easy to grep in logcat.
  console.log(`[coopfeeder-bg] ${message}`);
  await appendBackgroundLog(message);
}

/**
 * Check that the device has an active network connection before attempting to
 * reach the feeder. The actual TCP connection is made by fetchReading() below;
 * this is a cheap pre-check so we don't try to open a socket with no network.
 */
async function hasNetworkConnection(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    return state.isConnected === true;
  } catch {
    return false;
  }
}

// Define the task at module scope.
TaskManager.defineTask(FEEDER_BACKGROUND_TASK, async () => {
  await bgLog('task started');
  try {
    const hostname = await loadHostname();
    if (!hostname) {
      // Nothing configured yet; nothing to do.
      await bgLog('no hostname configured; skipping');
      return BackgroundTask.BackgroundTaskResult.Success;
    }
    await bgLog(`hostname: ${hostname}`);

    // 1. Check for a network/TCP connection first.
    if (!(await hasNetworkConnection())) {
      // No connectivity right now; succeed quietly and try again next window.
      await bgLog('no network connection; skipping');
      return BackgroundTask.BackgroundTaskResult.Success;
    }
    await bgLog('network ok');

    // 2. Open the actual TCP connection to the feeder and read its state.
    //    resolveBaseUrl handles mDNS (.local -> IP) since fetch can't do it.
    const baseUrl = await resolveBaseUrl(hostname);
    await bgLog(`resolved base url: ${baseUrl}`);
    const reading = await fetchReading(baseUrl);
    await bgLog(`fetched reading: level=${reading.level}${reading.units}`);
    await saveLastReading(reading);
    // Record when this automatic background check actually ran, separate from
    // any foreground refresh, so the UI can display it.
    await saveLastBackgroundRun();
    // Log every successful run so a background poll is observable in logcat
    // (filter for "coopfeeder"); otherwise success is silent.
    console.log(
      `[coopfeeder] background poll ok: level=${reading.level}${reading.units} at ${new Date().toISOString()}`,
    );

    // 3. Fire the low-feed alert only on the downward crossing below threshold.
    const isLow = reading.level < LOW_THRESHOLD;
    const wasLow = await loadWasLow();
    if (isLow && !wasLow) {
      await bgLog(`low feed (${reading.level}%); sending alert`);
      await sendLowFeedAlert(reading.level);
    }
    await saveWasLow(isLow);

    await bgLog('task finished OK');
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[coopfeeder-bg] task failed:', error);
    await bgLog(`task FAILED: ${msg}`);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/** Register the background poll (idempotent). */
export async function registerFeederBackgroundTask(): Promise<void> {
  const status = await BackgroundTask.getStatusAsync();
  if (status === BackgroundTask.BackgroundTaskStatus.Restricted) {
    // Background execution not available (e.g. web, or restricted by the OS).
    await bgLog('register skipped: background tasks Restricted');
    return;
  }
  const alreadyRegistered = await TaskManager.isTaskRegisteredAsync(FEEDER_BACKGROUND_TASK);
  if (alreadyRegistered) {
    await bgLog('register skipped: already registered');
    return;
  }
  await BackgroundTask.registerTaskAsync(FEEDER_BACKGROUND_TASK, {
    minimumInterval: INTERVAL_MINUTES,
  });
  await bgLog(`registered (minimumInterval=${INTERVAL_MINUTES}m)`);
}

/** Cancel the background poll. */
export async function unregisterFeederBackgroundTask(): Promise<void> {
  const alreadyRegistered = await TaskManager.isTaskRegisteredAsync(FEEDER_BACKGROUND_TASK);
  if (alreadyRegistered) {
    await BackgroundTask.unregisterTaskAsync(FEEDER_BACKGROUND_TASK);
  }
}

/**
 * DEBUG ONLY: immediately trigger the background worker (does not wait for the
 * OS window). Only works in development builds; a no-op in production.
 * Returns a human-readable status for display.
 */
export async function triggerBackgroundTaskForTesting(): Promise<string> {
  if (!__DEV__) {
    return 'Test trigger is only available in development builds.';
  }
  const registered = await TaskManager.isTaskRegisteredAsync(FEEDER_BACKGROUND_TASK);
  if (!registered) {
    return 'Task is not registered yet. Connect to a feeder first.';
  }
  await bgLog('manual test trigger requested');
  await BackgroundTask.triggerTaskWorkerForTestingAsync();
  return 'Triggered. Watch the log below (and adb logcat).';
}
