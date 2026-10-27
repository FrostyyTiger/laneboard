// server/cockpit/redact.mjs (spec c1-talk.md §5.3, security.md §5; D127,
// D211): one case per row of §5.3's table, the reply text's rules and its
// hold-back across deltas (S-SEC-02's node:test part: a secret split at every
// character position, and over three deltas). REVIEW-REQUIRED module.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRedactor, roomSecrets, REDACTED, HOLD_MAX, SECRET_MIN } from '../server/cockpit/redact.mjs';

const MCP = 'mcp-tok-5f1e2d3c';
const r = createRedactor({ secrets: [MCP, 'speech-tok-77aa', 'model-key-value-1'] });

const GHP = 'ghp_9xQ2abcdEFGH1234ijklMNOP5678qrstUV';
const PEM = '-----BEGIN OPENSSH PRIVATE KEY-----\nAAAAnot-a-key-1\nAAAAnot-a-key-2\n-----END OPENSSH PRIVATE KEY-----';

/** §5.3's table, one row per rule: [rule, input string, as a tool input's string, as reply text]. */
const ROWS = [
  [1, `curl -H x:${MCP} /mcp`, `curl -H x:${REDACTED} /mcp`, `curl -H x:${REDACTED} /mcp`],
  [1, 'speech speech-tok-77aa and model-key-value-1', `speech ${REDACTED} and ${REDACTED}`, `speech ${REDACTED} and ${REDACTED}`],
  [2, `before\n${PEM}\nafter`, `before\n${REDACTED}\nafter`, `before\n${REDACTED}\nafter`],
  [2, 'x -----BEGIN RSA PRIVATE KEY-----\nMIIEow no end', `x ${REDACTED}`, `x ${REDACTED}`],
  [3, 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc123DEF456ghi789', `Authorization: Bearer ${REDACTED}`, `Authorization: Bearer ${REDACTED}`],
  [3, 'use Basic dXNlcjpwYXNz now', `use Basic ${REDACTED} now`, `use Basic ${REDACTED} now`],
  [3, 'header Token abc.def', `header Token ${REDACTED}`, `header Token ${REDACTED}`],
  [3, 'bearer lower', `bearer ${REDACTED}`, 'bearer lower'],
  [4, 'https://example.invalid/hook?token=Q7wErTy12&lb_sig=Zq9Xw4Vr', `https://example.invalid/hook?token=${REDACTED}&lb_sig=${REDACTED}`, 'https://example.invalid/hook?token=Q7wErTy12&lb_sig=Zq9Xw4Vr'],
  [4, 'PGPASSWORD=hunter2 psql -h db', `PGPASSWORD=${REDACTED} psql -h db`, 'PGPASSWORD=hunter2 psql -h db'],
  [4, 'api_key: abc123, next', `api_key: ${REDACTED}, next`, 'api_key: abc123, next'],
  [4, 'tool --password hunter2 --user x', `tool --password ${REDACTED} --user x`, 'tool --password hunter2 --user x'],
  [4, 'tool --client-secret=s3 -v', `tool --client-secret=${REDACTED} -v`, 'tool --client-secret=s3 -v'],
  [4, '{"auth_token": "v1"}', `{"auth_token": "${REDACTED}"}`, '{"auth_token": "v1"}'],
  [4, 'Authorization: Bearer [redacted]', 'Authorization: Bearer [redacted]', 'Authorization: Bearer [redacted]'],
  [4, 'the key: restart it', `the key: ${REDACTED} it`, 'the key: restart it'],
  [5, `push with ${GHP} ok`, `push with ${REDACTED} ok`, `push with ${REDACTED} ok`],
  [5, 'sk-abcdefghij0123456789xyz gho_a ghs_b github_pat_c glpat-d xoxb-e xoxp-f',
    Array(7).fill(REDACTED).join(' '), Array(7).fill(REDACTED).join(' ')],
  [5, 'AKIAABCDEFGHIJKLMNOP done', `${REDACTED} done`, `${REDACTED} done`],
  [5, 'sk-short task-abcdefghijklmnopqrstuvwxyz', 'sk-short task-abcdefghijklmnopqrstuvwxyz', 'sk-short task-abcdefghijklmnopqrstuvwxyz'],
  [6, 'key eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ end', `key ${REDACTED} end`, `key ${REDACTED} end`],
  [6, 'git 3f2a9c1e7b4d5a6f8e9d0c1b2a3f4e5d6c7b8a9f uuid 0b7e5c2a-4d1f-4c3e-9a8b-2f6d1e0c7a91',
    'git 3f2a9c1e7b4d5a6f8e9d0c1b2a3f4e5d6c7b8a9f uuid 0b7e5c2a-4d1f-4c3e-9a8b-2f6d1e0c7a91',
    'git 3f2a9c1e7b4d5a6f8e9d0c1b2a3f4e5d6c7b8a9f uuid 0b7e5c2a-4d1f-4c3e-9a8b-2f6d1e0c7a91'],
  [6, 'digest e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    'digest e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    'digest e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
];

test('§5.3: one case per row, on a tool input string and on reply text (rule 4 is tool input only, D211)', () => {
  const seen = new Set();
  for (const [rule, s, asInput, asText] of ROWS) {
    seen.add(rule);
    assert.equal(r.input({ s }).s, asInput, `rule ${rule}, tool input: ${s}`);
    assert.equal(r.text(s), asText, `rule ${rule}, reply text: ${s}`);
  }
  assert.deepEqual([...seen].sort(), [1, 2, 3, 4, 5, 6]);
});

test('rule 4 on JSON keys: the key kept, its whole value (any type) "[redacted]"; other keys untouched', () => {
  const out = r.input({ api_key: 5, nested: { secret: { a: 1 }, list: ['ok', `Bearer ${GHP}`] }, PGPASSWORD: null, path: '/etc/laneboard' });
  assert.deepEqual(out, { api_key: REDACTED, nested: { secret: REDACTED, list: ['ok', `Bearer ${REDACTED}`] }, PGPASSWORD: REDACTED, path: '/etc/laneboard' });
  assert.deepEqual(r.input({ 'x-ghp_abc': 1 }), { 'x-ghp_abc': 1 }, 'JSON keys are never changed');
});

test('S-C1-31\'s two inputs read as the scenario writes them', () => {
  assert.equal(JSON.stringify(r.input({ pattern: 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc123DEF456ghi789', path: '/etc/laneboard' })),
    '{"pattern":"Authorization: Bearer [redacted]","path":"/etc/laneboard"}');
  assert.equal(JSON.stringify(r.input({ url: 'https://example.invalid/hook?token=Q7wErTy12&lb_sig=Zq9Xw4Vr' })),
    '{"url":"https://example.invalid/hook?token=[redacted]&lb_sig=[redacted]"}');
});

test('rule 1 ignores values under SECRET_MIN characters and empty ones (B70)', () => {
  const short = createRedactor({ secrets: ['abc', '', '   ', null] });
  assert.equal(short.text('abc abc'), 'abc abc');
  assert.equal(SECRET_MIN, 4);
  assert.equal(createRedactor({ secrets: ['abcd'] }).text('xabcdx'), `x${REDACTED}x`);
});

/** Pushes the pieces through one block's stream and returns what left, delta by delta, then the end. */
function play(pieces, red = r) {
  const st = red.stream();
  const out = pieces.map((p) => st.push(p));
  out.push(st.end());
  return out;
}

test('S-SEC-02\'s three deltas: the token held until it is whole, the reply as the scenario reads', () => {
  const out = play(['The token in /etc/acme/env is ghp_', '9xQ2abcdEFGH1234ijklMNOP5678qrstUV and', ' the key is below.']);
  assert.equal(out.join(''), 'The token in /etc/acme/env is [redacted] and the key is below.');
  assert.equal(out[0], 'The token in /etc/acme/env is ', 'the unfinished word waits');
  assert.ok(out.every((d) => !d.includes('ghp_') && !d.includes('9xQ2')));
  assert.deepEqual(play([PEM]), [REDACTED, ''], 'the key block leaves as one [redacted]');
});

const SECRETS_IN_PROSE = [
  [`see ${GHP} here`, `see ${REDACTED} here`, ['ghp_', '9xQ2', 'qrstUV']],
  [`x Bearer eyJhbGciOiJIUzI1NiJ9.abc123DEF456ghi789 y`, `x Bearer ${REDACTED} y`, ['eyJhbG', 'ghi789']],
  [`use ${MCP} now`, `use ${REDACTED} now`, [MCP.slice(0, 5), MCP.slice(-5)]],
  [`key:\n${PEM}\ndone`, `key:\n${REDACTED}\ndone`, ['PRIVATE KEY', 'AAAAnot']],
];

test('the hold-back: a secret split at every character position never leaves in part (S-SEC-02)', () => {
  for (const [whole, want, never] of SECRETS_IN_PROSE) {
    for (let i = 1; i < whole.length; i += 1) {
      const out = play([whole.slice(0, i), whole.slice(i)]);
      assert.equal(out.join(''), want, `split at ${i}: ${JSON.stringify(whole.slice(0, i))}`);
      for (const d of out) for (const bit of never) assert.ok(!d.includes(bit), `split at ${i}: ${JSON.stringify(d)} holds ${bit}`);
    }
  }
});

test('the hold-back: three-way splits of a token, every pair of positions', () => {
  const whole = `the token in /etc/acme/env is ${GHP} and more`;
  const want = `the token in /etc/acme/env is ${REDACTED} and more`;
  const from = whole.indexOf('ghp_') - 2;
  const to = from + GHP.length + 4;
  for (let i = from; i < to; i += 1) {
    for (let j = i + 1; j <= to; j += 1) {
      const out = play([whole.slice(0, i), whole.slice(i, j), whole.slice(j)]);
      assert.equal(out.join(''), want, `split at ${i}, ${j}`);
      assert.ok(out.every((d) => !d.includes('9xQ2') && !d.includes('ghp_')), `split at ${i}, ${j}`);
    }
  }
});

test('the hold-back sends a word at white space, a tail over 200 characters as it stands, a PEM block only at its end', () => {
  const st = r.stream();
  assert.equal(st.push('one two'), 'one ');
  assert.equal(st.held, 'two');
  assert.equal(st.push(' three\n'), 'two three\n');
  assert.equal(st.held, '');
  const long = 'a'.repeat(HOLD_MAX + 1);
  assert.equal(st.push(long), long, 'over 200 characters: checked and sent');
  const mixed = `${'aB3'.repeat(70)}`;
  assert.equal(st.push(` ${mixed}`), ` ${REDACTED}`, 'rule 6 redacts a long held tail that is a key');
  const pem = r.stream();
  assert.equal(pem.push('here:\n-----BEGIN OPENSSH PRIVATE KEY-----\n'), 'here:\n');
  assert.equal(pem.push('AAAA line one\nAAAA line two\n'), '', 'held until the END line');
  assert.equal(pem.end(), REDACTED, 'the block\'s end without an END line: rule 2 to the end');
  const after = r.stream();
  assert.equal(after.push(`${PEM}\nthen more`), `${REDACTED}\nthen `);
  assert.equal(after.end(), 'more');
});

test('a rule 3 word at the end of a delta waits with its credential (B73)', () => {
  assert.deepEqual(play(['send Bearer ', 'abc.def123 now']), ['send ', `Bearer ${REDACTED} `, 'now']);
  assert.deepEqual(play(['the token ', 'in it']), ['the token ', 'in ', 'it'], 'prose "token" is not rule 3 in reply text (B71)');
});

test('roomSecrets: the MCP token, the speech token file and the values of cockpit.agent.env', () => {
  const files = { '/s/stt.token': 'speech-1234\n' };
  const readFile = (f) => {
    if (!(f in files)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return files[f];
  };
  assert.deepEqual(roomSecrets({ mcpToken: MCP, env: { ANTHROPIC_API_KEY: 'k-1', TERM: 'xterm', EMPTY: '' }, names: ['ANTHROPIC_API_KEY', 'EMPTY', 'MISSING'], sttTokenFile: '/s/stt.token', readFile }),
    [MCP, 'k-1', 'speech-1234']);
  assert.deepEqual(roomSecrets({ sttTokenFile: '/s/none', readFile }), [], 'no file: nothing');
  assert.deepEqual(roomSecrets(), []);
});
