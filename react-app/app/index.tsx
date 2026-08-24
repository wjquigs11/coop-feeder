import Gauge from '@/Gauge';
import { LOW_THRESHOLD } from '@/backgroundTask';
import { useFeeder } from '@/useFeeder';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function FeederScreen() {
  const router = useRouter();
  const { status, reading, errorMessage, reloadFromStorage } = useFeeder();

  // Reload the saved hostname + last reading every time this screen gains
  // focus, so a connection made on the Settings screen shows up here.
  useFocusEffect(
    useCallback(() => {
      reloadFromStorage().catch(() => {});
    }, [reloadFromStorage]),
  );

  const connecting = status === 'connecting';
  const showGauge = status === 'connected' && reading != null;
  const fetchedAt =
    reading && 'fetchedAt' in reading && typeof reading.fetchedAt === 'number'
      ? reading.fetchedAt
      : null;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']}>
      <View style={styles.gaugeArea}>
        {connecting && <ActivityIndicator size="large" color="#6FADC0" />}

        {showGauge && reading && (
          <>
            <Gauge value={reading.level} units={reading.units} />
            {reading.level < LOW_THRESHOLD && (
              <Text style={styles.lowText}>Feed is low — refill soon</Text>
            )}
            {reading.lastUpdate != null && (
              <Text style={styles.refreshText}>
                Reading time: {new Date(reading.lastUpdate).toLocaleString()}
              </Text>
            )}
            {fetchedAt != null && (
              <Text style={styles.refreshText}>
                Last checked: {new Date(fetchedAt).toLocaleString()}
              </Text>
            )}
          </>
        )}

        {status === 'error' && (
          <Text style={styles.errorText}>{errorMessage ?? 'Something went wrong.'}</Text>
        )}

        {(status === 'idle' || (status === 'error' && !reading)) && !connecting && (
          <Text
            style={styles.hintText}
            onPress={() => router.push('/settings')}
          >
            No feeder connected. Tap the menu icon (top right) to set one up.
          </Text>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#fff',
  },
  gaugeArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 20,
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
