// No feeder: an empty feed that says so. `laneboard feed none` exists so a
// timer can be wired up before there is anything to read, and so the shape
// every feeder returns is visible with nothing behind it.
export const name = 'none';

export function toFeed(_input, { source = 'none', now = Date.now(), every = 60 } = {}) {
  return {
    source,
    at: now,
    every,
    note: 'the none feeder reads nothing',
    host: { sub: 'no feeder', alerts: [] },
    guests: [],
    events: [],
  };
}

export async function read() { return { ok: true, input: null }; }
