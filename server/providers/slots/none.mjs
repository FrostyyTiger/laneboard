// No slot provider: laneboard is a board, and nothing more.
//
// A lane still exists — a worktree with a branch and a plan — but nothing
// gives it a private database, so `launch` and `retire` refuse before they
// touch anything rather than half-making one.
export const name = 'none';
export const available = false;
export const slotCount = 0;

const REFUSAL = 'no slot provider configured: set slots.provider in the config file';

export function ports() { return null; }
export function envCommand() { return ''; }

export async function list() { return { ok: true, bySlot: new Map() }; }
export async function existing() { return []; }
export async function up() { return { ok: false, error: REFUSAL }; }
export async function env() { return { ok: false, error: REFUSAL, ports: {} }; }
export async function down() { return { ok: false, error: REFUSAL }; }
export async function dropVolumes() { return { ok: false, error: REFUSAL }; }
