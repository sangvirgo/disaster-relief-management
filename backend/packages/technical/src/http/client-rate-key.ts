import { isIPv4, isIPv6 } from 'node:net';

/**
 * Key that groups one client for abuse throttling.
 *
 * IPv4 stays exact: carrier-grade NAT and shelter Wi-Fi put many real people behind one address, so grouping a /24
 * would throttle whole neighbourhoods. IPv6 is grouped by its /64, because one subscriber usually controls a full
 * /64 and could otherwise rotate addresses to escape every per-IP limit. IPv4-mapped IPv6 maps back to IPv4.
 * Anything that is not an IP address is returned unchanged.
 */
export function clientRateKey(address: string | undefined | null): string {
  const raw = (address ?? '').trim();
  if (!raw) return 'unknown';
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(raw);
  if (mapped && isIPv4(mapped[1]!)) return mapped[1]!;
  if (isIPv4(raw)) return raw;
  const bare = raw.split('%')[0]!;
  if (!isIPv6(bare)) return raw;
  return `${expandIpv6(bare).slice(0, 4).join(':')}::/64`;
}

function expandIpv6(address: string): string[] {
  let text = address.toLowerCase();
  const embedded = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (embedded) {
    const [a, b, c, d] = embedded[1]!.split('.').map(Number) as [number, number, number, number];
    text = `${text.slice(0, -embedded[1]!.length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  let groups: string[];
  if (text.includes('::')) {
    const [head = '', tail = ''] = text.split('::');
    const left = head ? head.split(':') : [];
    const right = tail ? tail.split(':') : [];
    groups = [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right];
  } else {
    groups = text.split(':');
  }
  return groups.map((group) => parseInt(group, 16).toString(16));
}
