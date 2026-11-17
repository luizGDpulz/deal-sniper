import dns from 'node:dns/promises';
import net from 'node:net';

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'ref',
  'tag',
  'aff_id',
  'matt_tool',
  'matt_word',
  'awc',
]);

/**
 * Checks whether an IP address belongs to a private, loopback, link-local, or reserved range.
 */
export function isPrivateOrReservedIp(ip: string): boolean {
  const normalized = ip.trim().toLowerCase();

  if (normalized.startsWith('::ffff:')) {
    return isPrivateOrReservedIp(normalized.slice(7));
  }

  if (net.isIPv6(normalized)) {
    if (
      normalized === '::' ||
      normalized === '::1' ||
      normalized === '0:0:0:0:0:0:0:1' ||
      normalized === '0:0:0:0:0:0:0:0'
    ) {
      return true;
    }
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) {
      return true;
    }
    if (
      normalized.startsWith('fe8') ||
      normalized.startsWith('fe9') ||
      normalized.startsWith('fea') ||
      normalized.startsWith('feb')
    ) {
      return true;
    }
    if (normalized.startsWith('ff')) {
      return true;
    }
    return false;
  }

  if (net.isIPv4(normalized)) {
    const parts = normalized.split('.').map(Number);
    const [first, second] = parts;

    if (first === 0) return true; // 0.0.0.0/8
    if (first === 10) return true; // 10.0.0.0/8
    if (first === 100 && second >= 64 && second <= 127) return true; // 100.64.0.0/10 CGNAT
    if (first === 127) return true; // 127.0.0.0/8 Loopback
    if (first === 169 && second === 254) return true; // 169.254.0.0/16 Link-Local / Metadata
    if (first === 172 && second >= 16 && second <= 31) return true; // 172.16.0.0/12
    if (first === 192 && second === 168) return true; // 192.168.0.0/16
    if (first >= 224) return true; // Multicast & Reserved (224.0.0.0/4 + 240.0.0.0/4)
    return false;
  }

  return true;
}

/**
 * Validates that a URL uses http/https, has no embedded credentials, and resolves solely to public IPs.
 */
export async function assertSafeUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Invalid URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http and https protocols are allowed');
  }

  if (url.username || url.password) {
    throw new Error('URLs with embedded credentials are not allowed');
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    throw new Error('Local/internal hostnames are not allowed');
  }

  if (net.isIP(hostname)) {
    if (isPrivateOrReservedIp(hostname)) {
      throw new Error('Private or reserved IP address is not allowed');
    }
    return url;
  }

  let addresses: string[];
  try {
    const resolved = await dns.lookup(hostname, { all: true });
    addresses = resolved.map((entry) => entry.address);
  } catch {
    throw new Error('Failed to resolve hostname');
  }

  if (addresses.length === 0 || addresses.some((addr) => isPrivateOrReservedIp(addr))) {
    throw new Error('Hostname resolved to private or reserved IP');
  }

  return url;
}

/**
 * Strips common affiliate and analytics tracking query parameters while keeping product IDs intact.
 */
export function stripTrackingParams(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl;
  }

  for (const param of Array.from(url.searchParams.keys())) {
    if (TRACKING_PARAMS.has(param.toLowerCase())) {
      url.searchParams.delete(param);
    }
  }

  return url.toString();
}

/**
 * Resolves shortened/affiliate URLs manually while enforcing SSRF checks on every hop.
 */
export async function unshortenUrl(
  rawUrl: string,
  opts?: { maxRedirects?: number; timeoutMs?: number }
): Promise<{ finalUrl: string; resolved: boolean; error?: string }> {
  const maxRedirects = opts?.maxRedirects ?? 8;
  const timeoutMs = opts?.timeoutMs ?? 5000;

  let currentUrl = rawUrl;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    let safeUrl: URL;
    try {
      safeUrl = await assertSafeUrl(currentUrl);
    } catch (err) {
      return {
        finalUrl: stripTrackingParams(currentUrl),
        resolved: false,
        error: err instanceof Error ? err.message : 'Unsafe URL',
      };
    }

    let response: Response;
    try {
      response = await fetch(safeUrl.toString(), {
        method: 'HEAD',
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'User-Agent': 'deal-sniper/0.1 (+https://github.com/luizGDpulz/deal-sniper)' },
      });

      if (response.status === 405 || response.status === 403) {
        await response.body?.cancel();
        response = await fetch(safeUrl.toString(), {
          method: 'GET',
          redirect: 'manual',
          signal: AbortSignal.timeout(timeoutMs),
          headers: { 'User-Agent': 'deal-sniper/0.1 (+https://github.com/luizGDpulz/deal-sniper)' },
        });
      }
    } catch (err) {
      return {
        finalUrl: stripTrackingParams(currentUrl),
        resolved: false,
        error: err instanceof Error ? err.message : 'Fetch failed',
      };
    }

    const location = response.headers.get('location');
    await response.body?.cancel();

    if (response.status >= 300 && response.status < 400 && location) {
      currentUrl = new URL(location, safeUrl).toString();
      continue;
    }

    return {
      finalUrl: stripTrackingParams(safeUrl.toString()),
      resolved: true,
    };
  }

  return {
    finalUrl: stripTrackingParams(currentUrl),
    resolved: false,
    error: 'Too many redirects',
  };
}
