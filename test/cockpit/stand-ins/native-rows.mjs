// The native lines of `protocols.md` §11.4's left column, read from the protocol
// file (D136: `docs/cockpit/protocol.md` once the night made that copy, else the
// spec), and the check that a line the fake agent writes has its row's shape.
// Shared by test/cockpit-fake-agent.test.mjs and test/cockpit-scripts.test.mjs,
// so the fake, its scripts and the mapping rows cannot drift apart (B10).
//
//   assertRowShapes(lines)   every line has a §11.4 row and that row's shape
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../../..');

function protocolText() {
  for (const rel of ['docs/cockpit/protocol.md', 'docs/plans/cockpit/spec/protocols.md']) {
    const p = path.join(ROOT, rel);
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  }
  throw new Error('no protocol file');
}

/** The JSON of every row of §11.4's table. */
export function nativeRows() {
  const text = protocolText();
  const from = text.indexOf('### 11.4 ');
  const to = text.indexOf('### 11.5 ', from);
  const rows = [];
  for (const line of text.slice(from, to).split('\n')) {
    // A cell may add a note after its line (`… (after an \`interrupt\`)`).
    const m = /^\| `(\{.*?\})`[^|]*\|/.exec(line);
    if (m) rows.push(JSON.parse(m[1]));
  }
  return rows;
}

/** The fields that pick a row: type, subtype, the event and block types. */
export function rowKey(o) {
  const c = Array.isArray(o.message?.content) ? o.message.content[0]?.type : undefined;
  return [o.type, o.subtype, o.isReplay === true, o.event?.type, o.event?.content_block?.type, o.event?.delta?.type, c].join('|');
}

/**
 * Every field of `row` is in `line` with the same kind of value (unknown extra
 * fields allowed). A tool's `input` is the tool's own: an object, nothing more.
 */
export function hasShape(line, row, key) {
  if (row === null) return line === null;
  if (Array.isArray(row)) return Array.isArray(line) && (row.length === 0 || line.length === 0 || hasShape(line[0], row[0]));
  if (typeof row === 'object') {
    if (!line || typeof line !== 'object' || Array.isArray(line)) return false;
    if (key === 'input') return true;
    return Object.keys(row).every((k) => k in line && hasShape(line[k], row[k], k));
  }
  return typeof line === typeof row;
}

// Lines §11.4 maps to nothing, listed in its prose row.
const NO_EVENT = new Set(['ping', 'message_delta', 'message_stop', 'content_block_stop']);

/** Asserts each line has a §11.4 row and that row's shape; `what` names the lines in a failure. */
export function assertRowShapes(objs, what = '') {
  const rows = nativeRows();
  assert.ok(rows.length >= 15, `read ${rows.length} rows of §11.4`);
  const at = what ? ` (${what})` : '';
  for (const o of objs) {
    if (o.type === 'stream_event' && NO_EVENT.has(o.event.type)) continue;
    const candidates = rows.filter((r) => rowKey(r) === rowKey(o));
    assert.ok(candidates.length, `no §11.4 row for ${JSON.stringify(o)}${at}`);
    const ok = candidates.some((r) => {
      // `message_start` without `user_message_uuids` is the row's own "without either field" case.
      if (r.event?.type === 'message_start' && !o.user_message_uuids) { const { user_message_uuids, ...rest } = r; return hasShape(o, rest); }
      return hasShape(o, r);
    });
    assert.ok(ok, `line does not have its §11.4 row's shape${at}: ${JSON.stringify(o)}\nrows: ${candidates.map((r) => JSON.stringify(r)).join('\n')}`);
  }
}
