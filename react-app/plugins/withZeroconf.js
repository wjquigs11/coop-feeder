/**
 * Local Expo config plugin for react-native-zeroconf (mDNS/Bonjour).
 *
 * react-native-zeroconf has no first-party config plugin, so this injects the
 * native config that prebuild would otherwise not add:
 *   - Android: the permissions required for mDNS multicast discovery.
 *   - iOS 14+: NSBonjourServices (the service types we browse) and the
 *     NSLocalNetworkUsageDescription prompt string.
 *
 * The feeder advertises an _http._tcp service, so that's what we declare.
 */
const { AndroidConfig, withInfoPlist } = require('expo/config-plugins');

const ANDROID_PERMISSIONS = [
  'android.permission.INTERNET',
  'android.permission.ACCESS_NETWORK_STATE',
  'android.permission.ACCESS_WIFI_STATE',
  'android.permission.CHANGE_WIFI_MULTICAST_STATE',
];

// Use the built-in permissions helper (operates on the config, adding
// <uses-permission> entries via the proper manifest mod) rather than editing
// the manifest object by hand.
const withZeroconfAndroid = (config) =>
  AndroidConfig.Permissions.withPermissions(config, ANDROID_PERMISSIONS);

const withZeroconfIos = (config) =>
  withInfoPlist(config, (cfg) => {
    const plist = cfg.modResults;

    // Service types this app browses for over Bonjour.
    const services = new Set(plist.NSBonjourServices ?? []);
    services.add('_http._tcp.');
    plist.NSBonjourServices = Array.from(services);

    if (!plist.NSLocalNetworkUsageDescription) {
      plist.NSLocalNetworkUsageDescription =
        'This app uses the local network to find your feeder by its .local name.';
    }
    return cfg;
  });

module.exports = function withZeroconf(config) {
  config = withZeroconfAndroid(config);
  config = withZeroconfIos(config);
  return config;
};
