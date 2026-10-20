// The hub config the morning preview (test/tools/demo-fleet.mjs) boots, kept
// here so a test can boot the same thing (runs plan T3). `hostname` is set to
// a demo name: the header label and the Map's core node (`buildFleet` names
// the core `topo.title ?? config.hostname`) would otherwise show the machine
// the demo runs on.

export const DEMO_HOSTNAME = 'demo-host';

/**
 * @param {{builders: {id: string, url: string}[], origins: string[], publicHost: string}} opts
 */
export function demoHubConfig({ builders, origins, publicHost }) {
  return {
    hostname: DEMO_HOSTNAME,
    publicUrl: `https://${publicHost}`,
    fleet: {
      builders,
      allowedOrigins: origins,
      staleMs: 6000,
      downMs: 15_000,
      pingMs: 2000,
    },
  };
}
