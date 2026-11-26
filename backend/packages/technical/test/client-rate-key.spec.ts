import { clientRateKey } from '../src/http/client-rate-key';

describe('clientRateKey', () => {
  it('keeps IPv4 addresses exact so clients behind carrier-grade NAT are not merged with their neighbours', () => {
    expect(clientRateKey('203.0.113.41')).toBe('203.0.113.41');
    expect(clientRateKey('203.0.113.42')).toBe('203.0.113.42');
  });

  it('maps IPv4-mapped IPv6 back to the IPv4 address', () => {
    expect(clientRateKey('::ffff:203.0.113.41')).toBe('203.0.113.41');
  });

  it('groups every address of one IPv6 /64 under one key, whatever its spelling', () => {
    const key = clientRateKey('2001:db8:1:2::5');
    expect(key).toBe('2001:db8:1:2::/64');
    expect(clientRateKey('2001:0DB8:0001:0002:ffff:eeee:dddd:cccc')).toBe(key);
    expect(clientRateKey('2001:db8:1:2:a:b:c:d%eth0')).toBe(key);
    expect(clientRateKey('2001:db8:1:3::5')).not.toBe(key);
  });

  it('expands "::" inside the prefix and embedded IPv4 tails', () => {
    expect(clientRateKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(clientRateKey('64:ff9b::192.0.2.1')).toBe('64:ff9b:0:0::/64');
  });

  it('returns non-address values unchanged and labels a missing address', () => {
    expect(clientRateKey('phone:+84912345678')).toBe('phone:+84912345678');
    expect(clientRateKey(undefined)).toBe('unknown');
    expect(clientRateKey('')).toBe('unknown');
  });
});
