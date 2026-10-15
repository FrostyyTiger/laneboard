// The launch sheet. Moved from public/app.js (fleet F1).
import { $, el } from '../core/dom.js';

// ---------------------------------------------------------------- launch
//
// The sheet posts to /api/lanes and then shows the job's steps as they land.
// Validation errors (a taken id, no free slot, a plan that is not pushed)
// come back as the server's own sentence.

let launchPoll = null;

export function openLaunch() {
  $('launch-sheet').hidden = false;
  $('lf-steps').textContent = '';
  $('lf-submit').disabled = false;
  $('lf-lane').focus();
}

export function closeLaunch() {
  $('launch-sheet').hidden = true;
  clearTimeout(launchPoll);
  launchPoll = null;
}

function launchStep(text, cls) {
  const li = el('li', cls || null, text);
  $('lf-steps').append(li);
  return li;
}

export async function submitLaunch(e) {
  e?.preventDefault?.();
  const lane = $('lf-lane').value.trim();
  const body = {
    lane,
    repo: $('lf-repo').value.trim() || undefined,
    branch: $('lf-branch').value.trim() || undefined,
    plan: $('lf-plan').value.trim() || `docs/plans/${lane}.md`,
    model: $('lf-model').value,
  };
  $('lf-steps').textContent = '';
  $('lf-submit').disabled = true;
  let res;
  try {
    const r = await fetch('/api/lanes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    res = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(res.error || `HTTP ${r.status}`);
  } catch (err) {
    launchStep(`refused: ${err.message}`, 'bad');
    $('lf-submit').disabled = false;
    return;
  }
  launchStep(`${res.lane} on slot ${res.slot} — job ${res.job}`, 'dim');
  followLaunch(res.job, new Set());
}

export async function followLaunch(job, seen) {
  let data = null;
  try {
    const r = await fetch(`/api/jobs/${encodeURIComponent(job)}`);
    if (r.ok) data = await r.json();
  } catch { /* a restart mid-launch: keep polling */ }
  for (const st of data?.steps ?? []) {
    if (seen.has(st.id)) continue;
    seen.add(st.id);
    const why = st.detail?.error || st.detail?.warning || '';
    launchStep(`${st.ok === false ? '✗' : '✓'} ${st.step}${why ? ` — ${why}` : ''}`, st.ok === false ? 'bad' : 'ok');
    if (['done', 'failed', 'interrupted'].includes(st.step)) {
      $('lf-submit').disabled = false;
      return;
    }
  }
  if ($('launch-sheet').hidden) return;
  launchPoll = setTimeout(() => followLaunch(job, seen), 1500);
}
