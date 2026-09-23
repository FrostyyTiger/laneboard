// $ per million tokens, measured 2026-08-26 (plan §0).
// Columns: input / 5m cache write / 1h cache write / cache read / output.
const T = (input, w5m, w1h, read, output) => ({ input, w5m, w1h, read, output });

export const PRICES = {
  opus: T(5, 6.25, 10, 0.5, 25),
  sonnet5: T(2, 2.5, 4, 0.2, 10),
  sonnet4: T(3, 3.75, 6, 0.3, 15),
  fable5: T(10, 12.5, 20, 1, 50),
  haiku45: T(1, 1.25, 2, 0.1, 5),
};

/**
 * Map a model id to a price row.
 * Returns { key, price, pricedAsOpus }.
 *
 * `pricedAsOpus` means "we did not recognise this model and guessed" — an
 * unknown model shows up as probably-too-expensive rather than silently free.
 */
export function priceFor(modelId) {
  const id = String(modelId || '').toLowerCase();
  if (!id) return { key: 'opus', price: PRICES.opus, pricedAsOpus: true };

  if (id.includes('opus')) return { key: 'opus', price: PRICES.opus, pricedAsOpus: false };
  if (id.includes('haiku')) return { key: 'haiku45', price: PRICES.haiku45, pricedAsOpus: false };
  if (id.includes('fable')) return { key: 'fable5', price: PRICES.fable5, pricedAsOpus: false };
  if (id.includes('sonnet')) {
    // sonnet-5 is cheaper than sonnet-4.5/4.6; default a bare "sonnet" to the
    // dearer 4.x row so an unknown variant is never under-counted.
    if (/sonnet-?5/.test(id)) return { key: 'sonnet5', price: PRICES.sonnet5, pricedAsOpus: false };
    return { key: 'sonnet4', price: PRICES.sonnet4, pricedAsOpus: false };
  }
  return { key: 'opus', price: PRICES.opus, pricedAsOpus: true };
}

export const EMPTY_USAGE = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 });

/**
 * Normalise one `message.usage` block.
 * Cache-write split: prefer the explicit ephemeral_{1h,5m} counters; when they
 * are absent, all of cache_creation_input_tokens counts as a 5m write.
 */
export function normaliseUsage(usage) {
  const u = EMPTY_USAGE();
  if (!usage || typeof usage !== 'object') return u;
  u.input = num(usage.input_tokens);
  u.output = num(usage.output_tokens);
  u.cacheRead = num(usage.cache_read_input_tokens);
  const created = num(usage.cache_creation_input_tokens);
  const c = usage.cache_creation;
  if (c && typeof c === 'object') {
    u.cacheWrite1h = num(c.ephemeral_1h_input_tokens);
    u.cacheWrite5m = num(c.ephemeral_5m_input_tokens);
    // Trust the total when the split does not add up (a future third tier).
    const split = u.cacheWrite1h + u.cacheWrite5m;
    if (created > split) u.cacheWrite5m += created - split;
  } else {
    u.cacheWrite5m = created;
  }
  return u;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function addUsage(a, b) {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite5m: a.cacheWrite5m + b.cacheWrite5m,
    cacheWrite1h: a.cacheWrite1h + b.cacheWrite1h,
  };
}

/** USD for a normalised usage block under one model. */
export function cost(usage, modelId) {
  const { price, pricedAsOpus } = priceFor(modelId);
  const u = usage.input === undefined ? normaliseUsage(usage) : usage;
  const usd =
    (u.input * price.input +
      u.output * price.output +
      u.cacheRead * price.read +
      u.cacheWrite5m * price.w5m +
      u.cacheWrite1h * price.w1h) /
    1_000_000;
  return { usd, pricedAsOpus };
}

export function isEmptyUsage(u) {
  return !u || (!u.input && !u.output && !u.cacheRead && !u.cacheWrite5m && !u.cacheWrite1h);
}

/** Total a per-model usage map: { modelId: usage } -> { usd, pricedAsOpus, byModel }. */
export function costByModel(byModel) {
  let usd = 0;
  let pricedAsOpus = false;
  const detail = {};
  for (const [modelId, usage] of Object.entries(byModel)) {
    // "<synthetic>" and friends carry an all-zero usage block: $0, and they must
    // not raise the pricedAsOpus flag.
    if (isEmptyUsage(usage)) continue;
    const c = cost(usage, modelId);
    usd += c.usd;
    if (c.pricedAsOpus) pricedAsOpus = true;
    detail[modelId] = { usd: c.usd, usage, pricedAsOpus: c.pricedAsOpus };
  }
  return { usd, pricedAsOpus, byModel: detail };
}
