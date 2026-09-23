// Battery-optimization exemption helper (Android only).
//
// Samsung One UI (and other OEMs) aggressively defer or kill background work,
// which stops the WorkManager-backed background task from running on schedule.
// Asking the user to exempt the app from battery optimization is the single
// most effective reliability fix. iOS has no equivalent, so these are no-ops
// there.
import * as IntentLauncher from 'expo-intent-launcher';
import { Alert, Linking, Platform } from 'react-native';

/**
 * Open the system battery-optimization settings so the user can allow the app
 * to run in the background. We can't reliably detect the current state without
 * extra native code, so we just guide the user to the right screen.
 */
export async function openBatteryOptimizationSettings(): Promise<void> {
  if (Platform.OS !== 'android') {
    Alert.alert('Not needed', 'Battery optimization settings only apply on Android.');
    return;
  }

  // Preferred: the system "ignore battery optimizations" list.
  try {
    await IntentLauncher.startActivityAsync(
      'android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS',
    );
    return;
  } catch {
    // Some OEM builds don't expose that action; fall through.
  }

  // Fallback: this app's system settings page, where the user can find
  // Battery -> Unrestricted (the path Samsung One UI uses).
  try {
    await Linking.openSettings();
  } catch {
    Alert.alert(
      'Open settings manually',
      'Go to Settings > Apps > CoopFeeder > Battery and set it to Unrestricted so background checks can run.',
    );
  }
}

/** Short explanation shown next to the button (Samsung-specific guidance). */
export const BATTERY_HELP_TEXT =
  'Samsung phones stop background apps to save power, which prevents the daily ' +
  'check from running. Set this app to "Unrestricted" (Settings > Apps > ' +
  'CoopFeeder > Battery), and turn off "Put unused apps to sleep" for it.';
