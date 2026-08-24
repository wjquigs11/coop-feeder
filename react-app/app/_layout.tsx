import { registerFeederBackgroundTask } from '@/backgroundTask';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Image, Pressable, StyleSheet } from 'react-native';

// Relative require (not the '@/' alias) so Metro reliably bundles the asset.
const hamburgerIcon = require('../assets/images/hamburger.png');

export default function RootLayout() {
  const router = useRouter();

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
        <Stack.Screen
          name="index"
          options={{
            title: 'Coop Feeder',
            headerRight: () => (
              <Pressable
                onPress={() => router.push('/settings')}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Open settings"
              >
                <Image source={hamburgerIcon} style={styles.hamburger} resizeMode="contain" />
              </Pressable>
            ),
          }}
        />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
      </Stack>
    </>
  );
}

const styles = StyleSheet.create({
  hamburger: {
    width: 26,
    height: 26,
  },
});
