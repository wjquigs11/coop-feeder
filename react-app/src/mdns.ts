// mDNS resolution for .local hostnames.
//
// React Native's fetch (OkHttp on Android) does not resolve mDNS ".local"
// hostnames, even though the system browser can. The feeder advertises an
// _http._tcp Bonjour/mDNS service, so we browse for it with react-native-
// zeroconf, match the service whose host is the requested .local name, and
// return its IPv4 address. Callers then fetch against the IP instead of the
// unresolvable .local name.
//
// Non-.local hosts (raw IPs, regular DNS names) are returned unchanged.
import Zeroconf from 'react-native-zeroconf';

// Minimal shape of the resolved service objects we care about. (The library's
// own typings are loose, so we narrow to what we use.)
type ResolvedService = {
  name?: string;
  host?: string;
  addresses?: string[];
};

const RESOLVE_TIMEOUT_MS = 6000;
// Cache resolved host -> IP so we don't re-browse on every request. mDNS
// discovery is comparatively slow and, on Android, flaky under repeated scans.
const cache = new Map<string, string>();

/** True for names that need mDNS resolution (end in ".local"). */
function isMdnsHost(host: string): boolean {
  return /\.local$/i.test(host.replace(/\.$/, ''));
}

/** IPv4 dotted-quad check, so we prefer IPv4 over any IPv6 addresses. */
function isIpv4(addr: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(addr);
}

/** Normalize hostnames for comparison: lower-case, no trailing dot. */
function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/\.$/, '');
}

/**
 * Resolve a host to something fetch() can reach.
 * - "192.168.1.50"        -> unchanged
 * - "coopfeeder.local"    -> "192.168.1.50" (via mDNS), or throws if not found
 * - "example.com"         -> unchanged (normal DNS handles it)
 *
 * Successful .local resolutions are cached for subsequent calls.
 */
export async function resolveHost(host: string): Promise<string> {
  const clean = host.trim().replace(/\.$/, '');

  if (!isMdnsHost(clean)) {
    return clean;
  }

  const cached = cache.get(normalizeHost(clean));
  if (cached) {
    return cached;
  }

  const target = normalizeHost(clean);
  const zeroconf = new Zeroconf();

  const ip = await new Promise<string>((resolve, reject) => {
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        zeroconf.stop();
      } catch {
        // ignore
      }
      zeroconf.removeDeviceListeners();
      fn();
    };

    const onResolved = (service: ResolvedService) => {
      const serviceHost = service.host ? normalizeHost(service.host) : '';
      // Match either the advertised host (e.g. "coopfeeder.local") or the
      // service instance name (some responders name the service after the host).
      const serviceName = service.name ? normalizeHost(`${service.name}.local`) : '';
      const matches = serviceHost === target || serviceName === target;
      if (!matches) return;

      const addr = (service.addresses ?? []).find(isIpv4) ?? (service.addresses ?? [])[0];
      if (addr) {
        finish(() => resolve(addr));
      }
    };

    const timer = setTimeout(() => {
      finish(() =>
        reject(new Error(`Could not find ${clean} on the local network (mDNS timeout).`)),
      );
    }, RESOLVE_TIMEOUT_MS);

    zeroconf.on('resolved', onResolved);
    zeroconf.on('error', (err: unknown) => {
      finish(() =>
        reject(err instanceof Error ? err : new Error('mDNS discovery error.')),
      );
    });

    // DNSSD is the more reliable implementation on Android; ignored on iOS.
    zeroconf.scan('http', 'tcp', 'local.', 'DNSSD');
  });

  cache.set(target, ip);
  return ip;
}

/** Clear the cached hostname->IP mappings (e.g. if the feeder's IP changed). */
export function clearMdnsCache(): void {
  cache.clear();
}
