import { registerFeederBackgroundTask } from '@/backgroundTask';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

export default function RootLayout() {
  // Importing '@/backgroundTask' above runs TaskManager.defineTask at module
  // scope. Here we register it once when the app initializes.
  useEffect(() => {
    registerFeederBackgroundTask().catch((err) =>
      console.error('[coopfeeder] failed to register background task:', err),
    );
  }, []);

  return (
    <>
      <StatusBar style="auto" />
      <Stack>
        <Stack.Screen name="index" options={{ title: 'Coop Feeder' }} />
      </Stack>
    </>
  );
}
