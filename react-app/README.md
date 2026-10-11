
# coop-feeder app

Companion mobile app (Android, iOS, and web) for the coop-feeder — an ESP32-based
chicken feeder that measures the feed level with a load cell and exposes a small
HTTP API on the local network. Built with [Expo](https://expo.dev) and
[Expo Router](https://docs.expo.dev/router/introduction) in React Native and
TypeScript.

This app lives in the `react-app/` subfolder of the coop-feeder repo; the repo
root is the ESP32 firmware (PlatformIO). The two talk over the feeder's HTTP API.

## What the app does

- **Home** (`app/index.tsx`) — shows the current feed level on a circular
  **gauge**, the last-update time, and a manual **Refresh** button. Refreshes
  automatically when the screen gains focus and when the app returns to the
  foreground.
- **Settings** (`app/settings.tsx`) — enter the feeder hostname or IP and
  **connect**, run empty/full load-cell **calibration**, view the background-task
  log, and (dev builds) manually trigger the background poll. Also links to the
  Android battery-optimization settings, which affect background reliability.

It reads the feeder over plain HTTP, tracks whether feed is low, and raises a
low-feed notification (see below).

## How it talks to the feeder

- **HTTP API** (`src/api.ts`): polls `GET /readings` for the level, `GET
  /config?empty|full` to calibrate, and `POST /browsertime` to give the device a
  real clock reference. The device serves plain HTTP (no TLS); cleartext is
  enabled for Android via `expo-build-properties`.
- **mDNS `.local` resolution** (`src/mdns.ts`): React Native's fetch (OkHttp)
  can't resolve `.local` names on Android even though the browser can. The app
  browses the feeder's `_http._tcp` service with `react-native-zeroconf` and
  fetches against the resolved IP. Raw IPs and normal DNS names pass through.

## Low-feed alerts and background polling

- **Local notifications** (`src/notifications.ts`): permission + Android channel
  setup and the low-feed alert. `maybeAlertLowFeed()` is the single decision
  point shared by the foreground and background paths — it alerts on the drop
  below threshold and re-alerts at most once a day while feed stays low.
- **Background task** (`src/backgroundTask.ts`): an `expo-background-task`
  (WorkManager) worker `coopfeeder-poll`, defined at module scope and registered
  at startup, that polls and evaluates the alert. Its interval is a **floor, not
  a schedule** — 15 min in dev, ~24 h in prod — and it won't run while the app is
  force-stopped. For dependable alerts while the app is closed, see the push
  relay section further down.
- **Persistence** (`src/storage.ts`): hostname, last reading, was-low / last-alert
  flags, last background-run time, and a small background-log ring buffer, all in
  AsyncStorage so the UI and the background task share state.

## Tech stack

- Expo SDK 57 / React Native 0.86 / React 19
- Expo Router (file-based navigation), TypeScript
- expo-notifications, expo-background-task, expo-task-manager, expo-network
- react-native-zeroconf (mDNS), react-native-svg (gauge), AsyncStorage

## Project structure

```
app/                   # Screens + layout (file-based routes)
  _layout.tsx          # Root layout; registers the background task at startup
  index.tsx            # Home: gauge, last-update, refresh, foreground refresh
  settings.tsx         # Hostname/connect, calibration, background log, battery help
src/
  api.ts               # Feeder HTTP client (/readings, /config, /browsertime)
  mdns.ts              # Resolve .local (mDNS) hostnames to IPs for fetch
  useFeeder.ts         # Shared connect/read/refresh hook used by both screens
  notifications.ts     # Permission/channel + low-feed alert decision
  backgroundTask.ts    # 'coopfeeder-poll' WorkManager task + registration
  storage.ts           # AsyncStorage persistence shared with the background task
  Gauge.tsx            # SVG feed-level gauge
  battery.ts           # Android battery-optimization help + settings launcher
plugins/withZeroconf/  # Config plugin: Android permissions for zeroconf/mDNS
assets/                # Icons, splash, images
```

## Getting started

1. Install dependencies (required after a fresh clone — `node_modules` is not
   committed):

   ```bash
   npm install
   ```
2. Start Metro:

   ```bash
   npx expo start          # or: npm run dev  (targets a pinned device serial)
   ```

This app uses native modules (zeroconf, background task, notifications), so it
needs a **development build** — it does not run in Expo Go. Build and install a
dev build on a USB-connected Android device with:

```bash
npx expo run:android        # local build + install over adb, then starts Metro
```

For a USB dev build you also need Metro reachable from the device each session:

```bash
adb reverse tcp:8081 tcp:8081
```

### Scripts

```bash
npm run android   # expo run:android (local dev build + install)
npm run ios       # expo run:ios
npm run web       # expo start --web
npm run dev       # expo start --dev-client (pinned ANDROID_SERIAL)
npm run logcat    # capture device logs to /tmp/coopfeeder-logcat.log
npm run lint      # ESLint via expo lint
```

## Learn more

- [Expo documentation](https://docs.expo.dev/)
- [Expo Router](https://docs.expo.dev/router/introduction)

## Notifications while the app is closed (push relay — not yet implemented)

The app currently raises the low-feed alert as a **local notification**, fired
either from a foreground refresh or from the `expo-background-task` worker
(`src/backgroundTask.ts` → `maybeAlertLowFeed`). That works, but background-task
delivery is unreliable by design: on Android it is WorkManager, so
`minimumInterval` is only a floor, the OS batches/defers it for battery, and it
does not run at all while the app is force-stopped. So "tell me feed is low even
though the app is fully closed" is not dependable with the current approach.

The reliable way to notify when the app isn't running is **push**, where the
Android OS (Play Services / FCM), not our app, receives and displays the
notification. This section describes that design for when we decide to build it.
It is **not implemented yet.**

### Why the ESP32 can't push directly

Expo/FCM push requires an outbound HTTPS request (with TLS and project
credentials) to a cloud endpoint, plus storage of a per-device push token. The
feeder speaks plain HTTP on the LAN and shouldn't hold cloud credentials, so we
put a small **relay** between them.

### Delivery path

```
ESP32 feeder ──HTTP (LAN)──> relay ──HTTPS──> Expo push API ──> FCM ──> phone OS ──> notification
```

1. **Register (once, while the app runs).** The app requests a push token with
   `Notifications.getExpoPushTokenAsync()` and POSTs that token to the relay
   (e.g. `POST /register {token, feederId}`). The relay persists the token(s).
   The token identifies this install to FCM; it is not tied to the app running.
2. **Send (app can be closed).** When the feeder detects low feed, it makes a
   simple HTTP call to the relay on the LAN (e.g. `POST /notify {feederId,
   level}`). No TLS or credentials on the ESP32.
3. **Relay → Expo.** The relay POSTs to `https://exp.host/--/api/v2/push/send`
   with the stored token(s) and a title/body. It holds any credentials and does
   the TLS.
4. **Deliver.** Expo forwards to FCM; the always-on Play Services on the phone
   draws the notification banner itself. Our app is only launched if the user
   taps it.

### What building this requires

- **App side:** register for and upload the Expo push token (new code, plus the
  existing `expo-notifications` permission flow); handle the notification tap to
  deep-link into the app.
- **FCM setup:** Android push needs the FCM configuration in the Expo project
  (server key / `google-services.json`). Local notifications need none of this;
  push does. A dev build won't receive FCM push reliably without it.
- **Relay:** a tiny always-on HTTP service that stores device tokens and calls
  the Expo push API. Candidates: a small cloud function, or the always-on
  Graviton/NFS box on the home network. It must be reachable by both the feeder
  (LAN) and the internet (to reach Expo).
- **Firmware:** the ESP32 posts a low-feed event to the relay's LAN endpoint.

### Caveats / when push does NOT help

- **Requires internet, not just LAN.** The path is feeder → relay → Expo → FCM →
  phone. If the feeder or phone is offline (e.g. a boat/RPi deployment with no
  internet), push won't arrive.
- **LAN-only or intermittently-offline deployments:** push isn't an option;
  there the best available behavior is the background task (delivered only when
  the OS lets it run) plus the foreground refresh when the app is opened.

Decision guide: **has internet** → build the relay + push (reliable when the app
is closed). **LAN-only / sometimes offline** → keep the local-notification +
background-task approach and accept that closed-app delivery is best-effort.

## Supporting multiple feeders (BLE) — design note

The BLE service/characteristic UUIDs (`src/ble.ts`, firmware `src/ble.cpp`) are
hard-coded and **shared by every feeder on purpose**. A GATT service UUID
identifies the *type* of service ("a coop-feeder reading service"), not a
device — same idea as a port number or an API path. The app scans for that one
UUID to discover "any feeder," exactly like every heart-rate strap advertises
the same 0x180D Heart Rate UUID. So the shared UUID is correct and must not be
made per-device or configurable.

To tell multiple feeders apart, use **identity**, not the UUID:

- **Advertised name** — the human label. The firmware advertises under its
  `host` preference, so give each unit a distinct name ("Coop North", "Coop
  South"). The app sees it as `device.name` in scan results.
- **BLE MAC (`device.id`)** — the stable key to remember a chosen feeder.

What changes when a second feeder is added (not implemented yet):

1. **App:** the only single-feeder assumption is in `scanForFeeder()`, which
   returns the *first* match. Add a `scanForFeeders()` that accumulates all
   matches over the scan window as `{id, name}`, let the user pick, persist the
   chosen `device.id`, and have `connectBle()` / `readOnce()` target that id.
   The future background opportunistic-scan task would iterate the remembered
   feeder ids.
2. **Firmware:** nothing structural — just ensure each feeder's `host`/name is
   unique (already user-settable). Optionally add a small read-only "name"
   characteristic if you want the friendly name available after connect without
   relying on the advertisement.

Pattern summary: one shared service UUID to find the fleet; name + MAC to
distinguish units.
