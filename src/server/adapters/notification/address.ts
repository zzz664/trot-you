import 'server-only';
import { BlockList, isIP } from 'node:net';
import {
  WEBPUSH_BLOCKED_IPV4,
  WEBPUSH_BLOCKED_IPV6,
  WEBPUSH_ADDRESS_BITS,
} from '@/config/webpush-protocol';

const blocked = new BlockList();
for (const [network, prefix] of WEBPUSH_BLOCKED_IPV4)
  blocked.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of WEBPUSH_BLOCKED_IPV6)
  blocked.addSubnet(network, prefix, 'ipv6');
const globalIpv6 = new BlockList();
globalIpv6.addSubnet(...WEBPUSH_ADDRESS_BITS.globalIpv6, 'ipv6');

/** DNS result check before socket creation; never allow mapped/private IPs. */
export function isPublicWebPushAddress(address: string) {
  const family = isIP(address);
  if (family === 0) return false;
  if (family === WEBPUSH_ADDRESS_BITS.ipv4Family)
    return !blocked.check(address, 'ipv4');
  return globalIpv6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
}
