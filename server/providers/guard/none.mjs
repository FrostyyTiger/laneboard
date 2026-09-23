// No guard: nothing live sits next to laneboard, so nothing is watched.
//
// The Box shows no health block and no containers, and no session can ever be
// `danger` from the guard's side. This is the right provider on a machine
// whose agents have nothing shared to stumble into.
export const name = 'none';
export const active = false;

export function forbiddenPorts() { return []; }
export function healthProbes() { return []; }
export function containerFilter() { return ''; }

export async function health() { return []; }
export async function containers() { return { ok: true, list: [] }; }
export async function preventive() { return []; }
export async function detective() { return []; }
