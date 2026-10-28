// The pages of one screen (public/js/cockpit/screen-tabs.js; spec c1-talk.md
// §7 "Rate", §12, S-C1-43; build B234): an E9 refusal told to the sister
// pages over a BroadcastChannel, every note checked before it is drawn.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createScreenTabs, refusedNote, SCREEN_CHANNEL } from '../public/js/cockpit/screen-tabs.js';

const NOTE = { type: 'prompt.refused', clientId: 'p-3c1e0b2a', text: 'ping 11', at: 1793080820000, code: 'too-many' };

test('screen tabs: a refusal note is checked field by field', () => {
  assert.deepEqual(refusedNote(NOTE), { clientId: 'p-3c1e0b2a', text: 'ping 11', at: 1793080820000, code: 'too-many' });
  for (const bad of [
    null, 'x', {}, { ...NOTE, type: 'turn.prompt' }, { ...NOTE, code: 'agent-down' }, { ...NOTE, clientId: 'p-XYZ' },
    { ...NOTE, text: '   ' }, { ...NOTE, text: 'x'.repeat(8_001) }, { ...NOTE, text: 7 }, { ...NOTE, at: 'now' }, { ...NOTE, at: NaN },
  ]) assert.equal(refusedNote(bad), null, JSON.stringify(bad)?.slice(0, 60));
});

test('screen tabs: one page tells the others on the screen\'s channel; a bad note is dropped', async (t) => {
  const got = [];
  const a = createScreenTabs({ win: globalThis, onRefused: () => assert.fail('a page does not hear itself') });
  const b = createScreenTabs({ win: globalThis, onRefused: (n) => got.push(n) });
  const raw = new BroadcastChannel(SCREEN_CHANNEL);
  t.after(() => { a.close(); b.close(); raw.close(); });
  raw.postMessage({ ...NOTE, code: 'agent-down' });
  a.refused({ clientId: NOTE.clientId, text: NOTE.text, at: NOTE.at, code: 'too-many' });
  a.refused({ clientId: 'bad', text: NOTE.text, at: NOTE.at, code: 'too-many' }); // never posted
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(got, [{ clientId: 'p-3c1e0b2a', text: 'ping 11', at: 1793080820000, code: 'too-many' }]);
});

test('screen tabs: no BroadcastChannel is a no-op', () => {
  const tabs = createScreenTabs({ win: {} });
  tabs.refused(NOTE);
  tabs.close();
});
