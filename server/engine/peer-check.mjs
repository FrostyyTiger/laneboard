// Can this server tell tailscale serve from a program on the same machine?
// fleet.ingressPeerUid does that, on Linux only (docs/decisions.md).
//
//   'on'           set: a forged request on the ingress port is refused
//   'missing'      Linux without it: decisions are refused until it is set
//   'unavailable'  not Linux: it cannot be set, the page warns
export function peerCheck(config, platform = process.platform) {
  if (config?.fleet?.ingressPeerUid !== null && config?.fleet?.ingressPeerUid !== undefined) return 'on';
  return platform === 'linux' ? 'missing' : 'unavailable';
}
