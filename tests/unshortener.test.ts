import { describe, expect, it } from 'vitest';
import {
  assertSafeUrl,
  isPrivateOrReservedIp,
  stripTrackingParams,
  unshortenUrl,
} from '../src/security/unshortener.js';

describe('isPrivateOrReservedIp', () => {
  it('blocks loopback, RFC1918, CGNAT, link-local, and IPv4-mapped IPv6 addresses', () => {
    expect(isPrivateOrReservedIp('127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('10.0.0.5')).toBe(true);
    expect(isPrivateOrReservedIp('172.16.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('172.31.255.254')).toBe(true);
    expect(isPrivateOrReservedIp('192.168.1.1')).toBe(true);
    expect(isPrivateOrReservedIp('169.254.169.254')).toBe(true);
    expect(isPrivateOrReservedIp('100.64.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('::1')).toBe(true);
    expect(isPrivateOrReservedIp('fe80::1')).toBe(true);
    expect(isPrivateOrReservedIp('fc00::1')).toBe(true);
    expect(isPrivateOrReservedIp('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('::FFFF:169.254.169.254')).toBe(true);
  });

  it('allows public IPv4 and IPv6 addresses', () => {
    expect(isPrivateOrReservedIp('1.1.1.1')).toBe(false);
    expect(isPrivateOrReservedIp('8.8.8.8')).toBe(false);
    expect(isPrivateOrReservedIp('172.32.0.1')).toBe(false);
    expect(isPrivateOrReservedIp('2606:4700:4700::1111')).toBe(false);
  });
});

describe('assertSafeUrl & unshortenUrl', () => {
  it('rejects non-http protocols, credentials, and localhost/metadata targets', async () => {
    await expect(assertSafeUrl('file:///etc/passwd')).rejects.toThrow();
    await expect(assertSafeUrl('https://user:pass@example.com')).rejects.toThrow();
    await expect(assertSafeUrl('http://localhost:8080/admin')).rejects.toThrow();
    await expect(assertSafeUrl('http://169.254.169.254/latest/meta-data/')).rejects.toThrow();
    await expect(assertSafeUrl('http://[::ffff:127.0.0.1]/')).rejects.toThrow();

    const blocked = await unshortenUrl('http://127.0.0.1:5432/');
    expect(blocked.resolved).toBe(false);
    expect(blocked.error).toBeDefined();
  });

  it('strips affiliate tracking query parameters while keeping product parameters', () => {
    const cleaned = stripTrackingParams(
      'https://www.amazon.com.br/dp/B09V3KXJPB?tag=promo-20&utm_source=telegram&ref=dlx&psc=1'
    );
    expect(cleaned).toBe('https://www.amazon.com.br/dp/B09V3KXJPB?psc=1');
  });
});
