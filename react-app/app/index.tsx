import Gauge from '@/Gauge';
import { LOW_THRESHOLD } from '@/backgroundTask';
import { useFeeder } from '@/useFeeder';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  type AppStateStatus,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function FeederScreen() {
  const router = useRouter();
  const {
    status,
    reading,
    errorMessage,
    refreshFeeder,
    reloadFromStorage,
    lastBackgroundRun,
    lastRefreshAttempt,
    refreshError,
  } = useFeeder();

  // Reload the saved hostname + last reading every time this screen gains
  // focus (e.g. returning from Settings), then do a slim live refresh so the
  // gauge reflects the current level right when the app is opened — separate
  // from the once-a-day background task.
  useFocusEffect(
    useCallback(() => {
      (async () => {
        await reloadFromStorage();
        await refreshFeeder();
      })().catch(() => {});
    }, [reloadFromStorage, refreshFeeder]),
  );

  // Also refresh when the app returns to the foreground while already running
  // (warm resume: background/inactive -> active), which useFocusEffect alone
  // does not catch.
  const appState = useRef(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      const prev = appState.current;
      appState.current = next;
      if (next === 'active' && prev !== 'active') {
        refreshFeeder().catch(() => {});
      }
    });
    return () => sub.remove();
  }, [refreshFeeder]);

  // Tracks an in-flight manual refresh so the button can show progress and
  // avoid overlapping requests.
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(() => {
    if (refreshing) return;
    setRefreshing(true);
    refreshFeeder()
      .catch(() => {})
      .finally(() => setRefreshing(false));
  }, [refreshFeeder, refreshing]);

  const connecting = status === 'connecting';
  const showGauge = status === 'connected' && reading != null;
  const fetchedAt =
    reading && 'fetchedAt' in reading && typeof reading.fetchedAt === 'number'
      ? reading.fetchedAt
      : null;

  // "Last update" = the wall-clock time we last successfully read the feeder,
  // falling back to the last refresh attempt if we have no stored reading yet.
  const lastUpdate = fetchedAt ?? lastRefreshAttempt;

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
            <Text style={styles.lastUpdateText}>
              Last update:{' '}
              {lastUpdate != null ? new Date(lastUpdate).toLocaleString() : 'never'}
            </Text>
            <Pressable
              style={({ pressed }) => [
                styles.refreshButton,
                pressed && styles.refreshButtonPressed,
                refreshing && styles.refreshButtonDisabled,
              ]}
              onPress={handleRefresh}
              disabled={refreshing}
              accessibilityRole="button"
              accessibilityLabel="Refresh feeder reading"
            >
              {refreshing ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.refreshButtonText}>Refresh</Text>
              )}
            </Pressable>
            {reading.lastUpdate != null && (
              <Text style={styles.refreshText}>
                Reading time: {new Date(reading.lastUpdate).toLocaleString()}
              </Text>
            )}
            {fetchedAt != null && (
              <Text style={styles.refreshText}>
                Last successful read: {new Date(fetchedAt).toLocaleString()}
              </Text>
            )}
            {lastBackgroundRun != null && (
              <Text style={styles.refreshText}>
                Last background check: {new Date(lastBackgroundRun).toLocaleString()}
              </Text>
            )}
            {refreshError != null && (
              <Text style={styles.warnText}>
                Couldn&apos;t reach feeder{lastRefreshAttempt != null
                  ? ` at ${new Date(lastRefreshAttempt).toLocaleTimeString()}`
                  : ''}
                : {refreshError}
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
  lastUpdateText: {
    color: '#444',
    fontSize: 15,
    fontWeight: '600',
  },
  refreshButton: {
    marginTop: 4,
    minWidth: 120,
    minHeight: 44,
    paddingHorizontal: 24,
    borderRadius: 22,
    backgroundColor: '#208AEF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshButtonPressed: {
    backgroundColor: '#1B72C4',
  },
  refreshButtonDisabled: {
    opacity: 0.7,
  },
  refreshButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  warnText: {
    color: '#b8860b',
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 20,
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
