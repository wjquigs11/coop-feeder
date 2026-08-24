// Local (in-app) notification helper for the low-feed alert.
//
// Local notifications work in Expo Go and in development/production builds.
// (Only remote push notifications require a development build on SDK 53+.)
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

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
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Coop feeder is low',
      body: `Feed level has dropped to ${level}%. Time to refill.`,
      ...(Platform.OS === 'android' ? { channelId: ANDROID_CHANNEL_ID } : {}),
    },
    trigger: null, // deliver immediately
  });
}
