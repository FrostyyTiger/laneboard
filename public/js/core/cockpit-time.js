// Times on the cockpit's screen (cockpit spec README.md "Times on the screen",
// D232, D149): one rule for every time of day and every age the cockpit
// writes. Pure, no imports, so the room can import the same file.
//
//   clockText(ms, nowMs, tz?)  `06:41`, `yesterday 22:10`, `25 Oct 22:10`
//   ageText(ms, nowMs)         `(0 min)`, `(1 h 12)`, `(1 d 9 h)`
//   sinceText(ms, nowMs, tz?)  `since 06:41 (3 min)`: a condition that still holds
//   atText(ms, nowMs, tz?)     `at 07:04`, `yesterday at 22:10`, `on 25 Oct at 22:10`
//   hhmm(ms, tz?)              `07:02`: label times, never a day (D232)
//
// `tz` is an IANA zone; unset, the runtime's own (the page's path).

/** D149: `D Mon` in fixed English, whatever the screen's locale. */
export const MONTHS = Object.freeze(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);

const formats = new Map();
function partsOf(ms, timeZone) {
  const key = timeZone ?? '';
  let f = formats.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    formats.set(key, f);
  }
  const p = {};
  for (const { type, value } of f.formatToParts(new Date(ms))) p[type] = value;
  return { y: +p.year, mo: +p.month, d: +p.day, hh: p.hour, mm: p.minute };
}

/** Calendar days from `a` to `b` in the zone (b's day minus a's day). */
function dayDiff(a, b) {
  return Math.round((Date.UTC(b.y, b.mo - 1, b.d) - Date.UTC(a.y, a.mo - 1, a.d)) / 86_400_000);
}

/** `HH:MM`, 24 h, in the zone. */
export function hhmm(ms, timeZone) {
  const p = partsOf(ms, timeZone);
  return `${p.hh}:${p.mm}`;
}

/** The clock: the same day (or later, a clock skew) `HH:MM`; the day before `yesterday HH:MM`; else `D Mon HH:MM`. */
export function clockText(ms, nowMs, timeZone) {
  const p = partsOf(ms, timeZone);
  const days = dayDiff(p, partsOf(nowMs, timeZone));
  const t = `${p.hh}:${p.mm}`;
  if (days <= 0) return t;
  if (days === 1) return `yesterday ${t}`;
  return `${p.d} ${MONTHS[p.mo - 1]} ${t}`;
}

// ageText and sinceText are consts: views/board-card.js and views/morning.js
// have functions of those names for their own texts (test/frontend.test.mjs).

/** The age from the elapsed ms, whole units rounded down, in brackets; below 0 counts as 0. */
export const ageText = (ms, nowMs) => {
  const min = Math.floor(Math.max(0, nowMs - ms) / 60_000);
  if (min < 60) return `(${min} min)`;
  const h = Math.floor(min / 60);
  if (h < 24) return `(${h} h ${String(min % 60).padStart(2, '0')})`;
  return `(${Math.floor(h / 24)} d ${h % 24} h)`;
};

/** `since {clock} ({age})`. */
export const sinceText = (ms, nowMs, timeZone) => `since ${clockText(ms, nowMs, timeZone)} ${ageText(ms, nowMs)}`;

/** An event in the past: `at 07:04`, `yesterday at 22:10`, `on 25 Oct at 22:10`. */
export function atText(ms, nowMs, timeZone) {
  const c = clockText(ms, nowMs, timeZone);
  if (/^\d\d:\d\d$/.test(c)) return `at ${c}`;
  if (c.startsWith('yesterday ')) return `yesterday at ${c.slice(10)}`;
  const i = c.lastIndexOf(' ');
  return `on ${c.slice(0, i)} at ${c.slice(i + 1)}`;
}
