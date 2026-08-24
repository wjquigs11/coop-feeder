// Background task that wakes roughly once a day to poll the feeder.
//
// IMPORTANT: TaskManager.defineTask must run at module/global scope (not inside
// a React component) so the task is registered whenever the JS bundle loads —
// including when the OS relaunches the app to run the task in the background.
// Importing this module (e.g. from the root layout) is enough to define it.
import * as BackgroundTask from 'expo-background-task';
import * as Network from 'expo-network';
import * as TaskManager from 'expo-task-manager';

import { buildBaseUrl, fetchReading } from './api';
import { sendLowFeedAlert } from './notifications';
import { loadHostname, loadWasLow, saveLastReading, saveWasLow } from './storage';

export const FEEDER_BACKGROUND_TASK = 'coopfeeder-poll';

// ~24 hours. expo-background-task uses minutes; the OS treats this as a minimum
// and picks the actual run time (iOS typically runs during overnight windows).
const DAILY_INTERVAL_MINUTES = 24 * 60;

export const LOW_THRESHOLD = 10;

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
  try {
    const hostname = await loadHostname();
    if (!hostname) {
      // Nothing configured yet; nothing to do.
      return BackgroundTask.BackgroundTaskResult.Success;
    }

    // 1. Check for a network/TCP connection first.
    if (!(await hasNetworkConnection())) {
      // No connectivity right now; succeed quietly and try again next window.
      return BackgroundTask.BackgroundTaskResult.Success;
    }

    // 2. Open the actual TCP connection to the feeder and read its state.
    const baseUrl = buildBaseUrl(hostname);
    const reading = await fetchReading(baseUrl);
    await saveLastReading(reading);

    // 3. Fire the low-feed alert only on the downward crossing below threshold.
    const isLow = reading.level < LOW_THRESHOLD;
    const wasLow = await loadWasLow();
    if (isLow && !wasLow) {
      await sendLowFeedAlert(reading.level);
    }
    await saveWasLow(isLow);

    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (error) {
    console.error('[coopfeeder] background poll failed:', error);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/** Register the daily background poll (idempotent). */
export async function registerFeederBackgroundTask(): Promise<void> {
  const status = await BackgroundTask.getStatusAsync();
  if (status === BackgroundTask.BackgroundTaskStatus.Restricted) {
    // Background execution not available (e.g. web, or restricted by the OS).
    return;
  }
  const alreadyRegistered = await TaskManager.isTaskRegisteredAsync(FEEDER_BACKGROUND_TASK);
  if (alreadyRegistered) {
    return;
  }
  await BackgroundTask.registerTaskAsync(FEEDER_BACKGROUND_TASK, {
    minimumInterval: DAILY_INTERVAL_MINUTES,
  });
}

/** Cancel the daily background poll. */
export async function unregisterFeederBackgroundTask(): Promise<void> {
  const alreadyRegistered = await TaskManager.isTaskRegisteredAsync(FEEDER_BACKGROUND_TASK);
  if (alreadyRegistered) {
    await BackgroundTask.unregisterTaskAsync(FEEDER_BACKGROUND_TASK);
  }
}
