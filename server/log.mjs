// Tiny logger: stdout + a size-rotated file (10 MB x 3), per stage 9.
//
// Deliberately synchronous (appendFileSync, not createWriteStream). The volume
// here is a few lines a second, so the cost is irrelevant, and it buys two
// things a buffered stream does not:
//   * the on-disk size is always real, so rotation actually fires. With a
//     stream, a burst leaves everything in memory, the file may not exist yet,
//     the rename fails with ENOENT and the rotation silently never happens —
//     measured: one 40 MB file where there should have been four 10 MB ones.
//   * whatever was logged before a crash is on disk.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.mjs';

const MAX_BYTES = 10 * 1024 * 1024;
const KEEP = 3;

let size = null; // bytes in the current file; null until we have looked

function currentSize() {
  if (size !== null) return size;
  try {
    size = fs.statSync(config.logPath).size;
  } catch {
    size = 0;
  }
  return size;
}

function rotate() {
  try {
    for (let i = KEEP - 1; i >= 1; i--) {
      const from = `${config.logPath}.${i}`;
      if (fs.existsSync(from)) fs.renameSync(from, `${config.logPath}.${i + 1}`);
    }
    if (fs.existsSync(config.logPath)) fs.renameSync(config.logPath, `${config.logPath}.1`);
    const oldest = `${config.logPath}.${KEEP + 1}`;
    if (fs.existsSync(oldest)) fs.unlinkSync(oldest);
    size = 0;
  } catch {
    // Rotation failing must not stop logging, and must not reset the counter —
    // that would mean it never retries and the file grows forever.
  }
}

function append(line) {
  const bytes = Buffer.byteLength(line);
  if (currentSize() + bytes >= MAX_BYTES) rotate();
  try {
    fs.mkdirSync(path.dirname(config.logPath), { recursive: true });
    fs.appendFileSync(config.logPath, line);
    size = currentSize() + bytes;
  } catch {
    size = null; // re-stat next time rather than drift
  }
}

function write(level, args) {
  const line = `${new Date().toISOString()} ${level} ${args
    .map((a) => (typeof a === 'string' ? a : inspect(a)))
    .join(' ')}\n`;
  process.stdout.write(line);
  append(line);
}

function inspect(v) {
  try { return JSON.stringify(v); } catch { return String(v); }
}

export const log = {
  info: (...a) => write('INFO', a),
  warn: (...a) => write('WARN', a),
  error: (...a) => write('ERROR', a),
};

export default log;
