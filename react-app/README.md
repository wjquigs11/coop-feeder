
# coop-feeder

A cross-platform (iOS, Android, and web) mobile app built with [Expo](https://expo.dev) and [Expo Router](https://docs.expo.dev/router/introduction), using React Native and TypeScript.

> **Status:** This is currently the project scaffold generated from the Expo Router starter template. The two screens shipped today (Home and Explore) are example/onboarding screens; the coop-feeder feature work is yet to be built on top of this foundation.

## What the app does

The app boots into a native tabbed interface with two screens:

- **Home** (`src/app/index.tsx`) — a welcome/hero screen with an animated icon and quick "get started" hints (editing entry points, opening dev tools, resetting the project).
- **Explore** (`src/app/explore.tsx`) — a scrollable screen with collapsible sections explaining the template's features (file-based routing, multi-platform support, images, light/dark mode, animations).

Both screens run natively on iOS and Android and render on the web from the same codebase.

## Key features

- **File-based routing** via Expo Router — screens live in `src/app/` and the tab navigator is configured in `src/app/_layout.tsx`.
- **Native bottom tabs** using `expo-router/unstable-native-tabs` (`src/components/app-tabs.tsx`), with a web-specific variant.
- **Light and dark mode** driven by the system color scheme (`useColorScheme`), with a shared theme in `src/constants/theme.ts` and themed primitives (`ThemedText`, `ThemedView`).
- **Animations** with `react-native-reanimated`, including an animated splash overlay and the collapsible sections.
- **Typed routes** and the React Compiler enabled (see `app.json` → `experiments`).

## Tech stack

- Expo SDK 57 / React Native 0.86
- React 19
- Expo Router (file-based navigation)
- TypeScript
- react-native-reanimated, react-native-gesture-handler, react-native-safe-area-context

## Project structure

```
src/
  app/                 # Screens + layout (file-based routes)
    _layout.tsx        # Root layout: theme provider, splash overlay, tabs
    index.tsx          # Home screen
    explore.tsx        # Explore screen
  components/          # Reusable UI (themed text/view, tabs, links, badges)
    ui/                # Lower-level UI primitives (e.g. collapsible)
  constants/
    theme.ts           # Colors, spacing, layout constants
  hooks/               # useColorScheme / useTheme (with web variants)
  global.css           # Global styles (web)
assets/                # Icons, splash, images
```

Files with `.web.tsx` / `.web.ts` suffixes provide web-specific implementations that Expo picks up automatically.

## Getting started

1. Install dependencies:

   ```bash
   npm install
   ```
2. Start the development server:

   ```bash
   npx expo start
   ```

   From the Expo CLI output you can open the app in:

   - a [development build](https://docs.expo.dev/develop/development-builds/introduction/)
   - an [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
   - an [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
   - [Expo Go](https://expo.dev/go)

### Platform shortcuts

```bash
npm run ios       # open in iOS simulator
npm run android   # open in Android emulator
npm run web       # open in the browser
npm run lint      # run ESLint via expo lint
```

## Resetting to a blank app

To move the current example code aside and start with a clean `app` directory:

```bash
npm run reset-project
```

## Learn more

- [Expo documentation](https://docs.expo.dev/)
- [Expo Router](https://docs.expo.dev/router/introduction)
