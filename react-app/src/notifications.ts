// Local (in-app) notification helper for the low-feed alert.
//
// Local notifications work in Expo Go and in development/production builds.
// (Only remote push notifications require a development build on SDK 53+.)
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import {
  clearLastLowAlert,
  loadLastLowAlert,
  saveLastLowAlert,
  saveWasLow,
} from './storage';

// While feed stays below threshold, re-send a reminder at most this often so
// the user still gets nagged if they never open the app, without spamming.
const LOW_REALERT_MS = 24 * 60 * 60 * 1000; // 24h

// Show an alert/banner even when the app is in the foreground.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const ANDROID_CHANNEL_ID = 'coop-feeder-alerts';

/**
 * Request notification permission and set up the Android channel.
 * Returns true if notifications are allowed.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: 'Feeder alerts',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') {
    return true;
  }
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

/** Fire an immediate local notification warning that feed is low. */
export async function sendLowFeedAlert(level: number): Promise<void> {
  // Ensure the Android channel exists and permission is granted before we post.
  // The background task runs in a fresh JS context that may never have gone
  // through the foreground connect() flow, so the channel/permission it relies
  // on might not exist yet. This is a no-op when already set up.
  const allowed = await ensureNotificationPermission();
  if (!allowed) return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Coop feeder is low',
      body: `Feed level has dropped to ${level}%. Time to refill.`,
      ...(Platform.OS === 'android' ? { channelId: ANDROID_CHANNEL_ID } : {}),
    },
    trigger: null, // deliver immediately
  });
}

/**
 * Single source of truth for the low-feed alert decision, shared by BOTH the
 * foreground refresh and the background task so they behave identically and
 * don't fight over the same edge.
 *
 * Policy:
 *  - Alert on the downward crossing (first reading below `threshold`).
 *  - While it STAYS low, re-alert at most once per LOW_REALERT_MS. This is what
 *    lets the background task still notify even if a foreground refresh already
 *    saw the low level earlier — previously the foreground path would set the
 *    "was low" flag and silence the background task forever.
 *  - Reset once feed goes back above threshold, so the next drop alerts again.
 *
 * Persists both the wasLow flag and the last-alert timestamp so the decision
 * survives across the separate JS contexts of foreground and background runs.
 */
export async function maybeAlertLowFeed(level: number, threshold: number): Promise<void> {
  const isLow = level < threshold;

  if (!isLow) {
    await saveWasLow(false);
    await clearLastLowAlert();
    return;
  }

  const lastAlert = await loadLastLowAlert();
  const now = Date.now();
  const due = lastAlert == null || now - lastAlert >= LOW_REALERT_MS;

  if (due) {
    await sendLowFeedAlert(level);
    await saveLastLowAlert(now);
  }
  await saveWasLow(true);
}
