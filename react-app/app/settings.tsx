import { triggerBackgroundTaskForTesting } from '@/backgroundTask';
import { BATTERY_HELP_TEXT, openBatteryOptimizationSettings } from '@/battery';
import {
  clearBackgroundLog,
  loadBackgroundLog,
  type BackgroundLogEntry,
} from '@/storage';
import { useFeeder } from '@/useFeeder';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function SettingsScreen() {
  const router = useRouter();
  const { hostname, setHostname, status, errorMessage, connect, calibrateFeeder, reloadFromStorage } =
    useFeeder();

  // Which calibration (if any) is currently running.
  const [calibrating, setCalibrating] = useState<'empty' | 'full' | null>(null);
  const [calibrationMessage, setCalibrationMessage] = useState<string | null>(null);

  // Background-task debugging state.
  const [bgLog, setBgLog] = useState<BackgroundLogEntry[]>([]);
  const [triggerMessage, setTriggerMessage] = useState<string | null>(null);

  const refreshBgLog = useCallback(async () => {
    setBgLog(await loadBackgroundLog());
  }, []);

  // Prefill the field with the currently saved hostname and load the log
  // whenever the screen gains focus.
  useFocusEffect(
    useCallback(() => {
      reloadFromStorage().catch(() => {});
      refreshBgLog().catch(() => {});
    }, [reloadFromStorage, refreshBgLog]),
  );

  const onTriggerBackgroundTask = async () => {
    setTriggerMessage(null);
    try {
      const msg = await triggerBackgroundTaskForTesting();
      setTriggerMessage(msg);
    } catch (err) {
      setTriggerMessage(err instanceof Error ? err.message : 'Trigger failed.');
    }
    // Give the worker a moment, then refresh the log.
    setTimeout(() => {
      refreshBgLog().catch(() => {});
    }, 1500);
  };

  const onClearBgLog = async () => {
    await clearBackgroundLog();
    await refreshBgLog();
    setTriggerMessage(null);
  };

  const connecting = status === 'connecting';
  const busy = connecting || calibrating != null;

  const onConnect = async () => {
    const ok = await connect(hostname);
    if (ok) {
      // Head back to the gauge; it reloads the new reading on focus.
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/');
      }
    }
  };

  const runCalibration = async (which: 'empty' | 'full') => {
    setCalibrationMessage(null);
    setCalibrating(which);
    try {
      const message = await calibrateFeeder(which);
      setCalibrationMessage(message || `Calibrated ${which}.`);
    } catch (err) {
      setCalibrationMessage(
        err instanceof Error ? err.message : `Could not calibrate ${which}.`,
      );
    } finally {
      setCalibrating(null);
    }
  };

  const confirmCalibration = (which: 'empty' | 'full') => {
    const label = which === 'empty' ? 'empty' : 'full';
    Alert.alert(
      `Calibrate ${label}`,
      `Make sure the feeder is ${label}, then confirm. This overwrites the current ${label} reference point on the device.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: `Calibrate ${label}`, onPress: () => runCalibration(which) },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.heading}>Feeder connection</Text>
        <Text style={styles.help}>
          Enter your feeder&apos;s hostname or IP address, then tap Connect.
        </Text>

        <View style={styles.field}>
          <Text style={styles.label}>feeder:</Text>
          <TextInput
            style={styles.input}
            value={hostname}
            onChangeText={setHostname}
            placeholder="hostname or IP"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            onSubmitEditing={onConnect}
            editable={!connecting}
          />
        </View>

        <Pressable
          style={[styles.button, busy && styles.buttonDisabled]}
          onPress={onConnect}
          disabled={busy}
        >
          {connecting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Connect</Text>
          )}
        </Pressable>

        {status === 'error' && (
          <Text style={styles.errorText}>{errorMessage ?? 'Something went wrong.'}</Text>
        )}

        <View style={styles.divider} />

        <Text style={styles.heading}>Calibration</Text>
        <Text style={styles.help}>
          Set the feeder&apos;s empty and full reference points. Empty the feeder before
          calibrating empty, and fill it before calibrating full.
        </Text>

        <View style={styles.calRow}>
          <Pressable
            style={[styles.calButton, busy && styles.buttonDisabled]}
            onPress={() => confirmCalibration('empty')}
            disabled={busy}
          >
            {calibrating === 'empty' ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Calibrate empty</Text>
            )}
          </Pressable>

          <Pressable
            style={[styles.calButton, busy && styles.buttonDisabled]}
            onPress={() => confirmCalibration('full')}
            disabled={busy}
          >
            {calibrating === 'full' ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Calibrate full</Text>
            )}
          </Pressable>
        </View>

        {calibrationMessage != null && (
          <Text style={styles.calMessage}>{calibrationMessage}</Text>
        )}

        <View style={styles.divider} />

        <Text style={styles.heading}>Background updates</Text>
        <Text style={styles.help}>{BATTERY_HELP_TEXT}</Text>

        <Pressable style={styles.button} onPress={openBatteryOptimizationSettings}>
          <Text style={styles.buttonText}>Allow background activity</Text>
        </Pressable>

        {__DEV__ && (
          <>
            <Pressable style={styles.secondaryButton} onPress={onTriggerBackgroundTask}>
              <Text style={styles.secondaryButtonText}>Run background check now (debug)</Text>
            </Pressable>
            {triggerMessage != null && <Text style={styles.calMessage}>{triggerMessage}</Text>}
          </>
        )}

        <View style={styles.logHeaderRow}>
          <Text style={styles.subHeading}>Background log</Text>
          <View style={styles.logHeaderButtons}>
            <Pressable onPress={refreshBgLog} hitSlop={8}>
              <Text style={styles.linkText}>Refresh</Text>
            </Pressable>
            <Pressable onPress={onClearBgLog} hitSlop={8}>
              <Text style={styles.linkText}>Clear</Text>
            </Pressable>
          </View>
        </View>

        {bgLog.length === 0 ? (
          <Text style={styles.help}>No background runs recorded yet.</Text>
        ) : (
          <View style={styles.logBox}>
            {[...bgLog].reverse().map((entry, i) => (
              <Text key={`${entry.at}-${i}`} style={styles.logLine}>
                {new Date(entry.at).toLocaleString()} — {entry.message}
              </Text>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#fff',
  },
  container: {
    flex: 1,
    padding: 20,
    gap: 14,
  },
  heading: {
    fontSize: 20,
    fontWeight: '700',
    color: '#222',
  },
  help: {
    fontSize: 14,
    color: '#666',
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
  label: {
    fontSize: 18,
    fontWeight: '600',
    color: '#222',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  button: {
    backgroundColor: '#6FADC0',
    paddingVertical: 13,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 16,
  },
  errorText: {
    color: '#c0392b',
    fontSize: 15,
  },
  divider: {
    height: 1,
    backgroundColor: '#eee',
    marginVertical: 8,
  },
  calRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  calButton: {
    flex: 1,
    backgroundColor: '#6FADC0',
    paddingVertical: 13,
    borderRadius: 8,
    alignItems: 'center',
  },
  calMessage: {
    fontSize: 14,
    color: '#444',
  },
  secondaryButton: {
    backgroundColor: '#eef4f6',
    borderWidth: 1,
    borderColor: '#6FADC0',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#3d7c8f',
    fontWeight: '600',
    fontSize: 15,
  },
  subHeading: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
  },
  logHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  logHeaderButtons: {
    flexDirection: 'row',
    gap: 16,
  },
  linkText: {
    color: '#3d7c8f',
    fontWeight: '600',
    fontSize: 14,
  },
  logBox: {
    backgroundColor: '#f7f7f7',
    borderRadius: 8,
    padding: 10,
    gap: 4,
  },
  logLine: {
    fontSize: 12,
    color: '#444',
    fontFamily: 'monospace',
  },
});
