// A room time as the protocol writes it (D59): ISO 8601 with the room's own
// offset and milliseconds, `2026-10-27T07:02:04.130+01:00`.

const pad = (n, w = 2) => String(Math.trunc(Math.abs(n))).padStart(w, '0');

/** `ms` (epoch) as ISO 8601 in the process's time zone. */
export function isoAt(ms) {
  const d = new Date(ms);
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    + `.${pad(d.getMilliseconds(), 3)}${sign}${pad(off / 60)}:${pad(off % 60)}`;
}
