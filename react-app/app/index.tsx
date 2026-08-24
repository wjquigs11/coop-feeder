import Gauge from '@/Gauge';
import { buildBaseUrl, fetchReading, sendBrowserTime, type Reading } from '@/api';
import { LOW_THRESHOLD, registerFeederBackgroundTask } from '@/backgroundTask';
import { ensureNotificationPermission, sendLowFeedAlert } from '@/notifications';
import {
  loadHostname,
  loadLastReading,
  loadWasLow,
  saveHostname,
  saveLastReading,
  saveWasLow,
} from '@/storage';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type Status = 'idle' | 'connecting' | 'connected' | 'error';

export default function FeederScreen() {
  const [hostname, setHostname] = useState('coopfeeder.local');
  const [status, setStatus] = useState<Status>('idle');
  const [reading, setReading] = useState<Reading | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // On mount, restore the last hostname and whatever reading the background
  // task (or a previous session) last stored, so the gauge isn't blank.
  useEffect(() => {
    (async () => {
      const savedHost = await loadHostname();
      if (savedHost) setHostname(savedHost);
      const last = await loadLastReading();
      if (last) {
        setReading(last);
        setStatus('connected');
      }
    })().catch(() => {});
  }, []);

  // Apply a fresh reading to the UI and persist it, firing the low-feed alert
  // only on the downward crossing below the threshold. The "was low" flag is
  // persisted so this stays consistent with the background task.
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

  const connect = useCallback(async () => {
    Keyboard.dismiss();

    let baseUrl: string;
    try {
      baseUrl = buildBaseUrl(hostname);
    } catch (err) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Invalid hostname.');
      return;
    }

    setStatus('connecting');
    setErrorMessage(null);

    // Persist the hostname so the background task knows which feeder to poll.
    await saveHostname(hostname.trim());

    // Ask for notification permission up front so the alert can fire later.
    await ensureNotificationPermission();

    // Best-effort: give the device a real clock reference.
    sendBrowserTime(baseUrl).catch(() => {});

    // One immediate foreground read so the user sees current state right away.
    // Ongoing updates come from the ~24h background task, not a polling loop.
    try {
      const first = await fetchReading(baseUrl);
      await handleReading(first);
      // Make sure the daily background poll is registered.
      await registerFeederBackgroundTask();
    } catch (err) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Could not reach the feeder.');
    }
  }, [hostname, handleReading]);

  const connecting = status === 'connecting';
  const showGauge = status === 'connected' && reading != null;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
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
            onSubmitEditing={connect}
            editable={!connecting}
          />
          <Pressable
            style={[styles.button, connecting && styles.buttonDisabled]}
            onPress={connect}
            disabled={connecting}
          >
            <Text style={styles.buttonText}>{connecting ? '...' : 'Connect'}</Text>
          </Pressable>
        </View>

        <View style={styles.gaugeArea}>
          {connecting && <ActivityIndicator size="large" color="#6FADC0" />}

          {showGauge && reading && (
            <>
              <Gauge value={reading.level} units={reading.units} />
              {reading.level < LOW_THRESHOLD && (
                <Text style={styles.lowText}>Feed is low — refill soon</Text>
              )}
              <Text style={styles.refreshText}>
                {reading.lastUpdate
                  ? `Reading time: ${new Date(reading.lastUpdate).toLocaleString()}`
                  : 'Device clock not set'}
              </Text>
              {'fetchedAt' in reading && typeof (reading as { fetchedAt?: number }).fetchedAt === 'number' && (
                <Text style={styles.refreshText}>
                  Last checked: {new Date((reading as { fetchedAt: number }).fetchedAt).toLocaleString()}
                </Text>
              )}
              <Text style={styles.hintText}>Checks automatically about once a day.</Text>
            </>
          )}

          {status === 'error' && (
            <Text style={styles.errorText}>{errorMessage ?? 'Something went wrong.'}</Text>
          )}

          {status === 'idle' && (
            <Text style={styles.hintText}>Enter your feeder&apos;s hostname and tap Connect.</Text>
          )}
        </View>
      </View>
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
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
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
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 16,
  },
  gaugeArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  lowText: {
    color: '#c0392b',
    fontWeight: '600',
    fontSize: 16,
  },
  refreshText: {
    color: '#666',
    fontSize: 13,
  },
  errorText: {
    color: '#c0392b',
    fontSize: 15,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  hintText: {
    color: '#888',
    fontSize: 15,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
});
