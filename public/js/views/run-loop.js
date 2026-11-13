// The loop on a run page (docs/run-loop.md): the run's pattern drawn as stations
// and edges, the spot it is at lit, and under it the callout, the one place
// that says what needs you, with the one control row.
//
// The shape comes from core/loop.js (the pattern doc, station by station); this
// file only places it. Wide screens get the drawing, phones the same stations
// as a list (it is also the drawing's text for screen readers).
//
// Engine text goes in through textContent and setAttribute only.
import { decisionButton } from './engine-actions.js';
import { el, svg } from '../core/dom.js';
import { rnClean } from '../core/run-text.js';
import { blockedRun, loopPosition, paramsOf, patternOf, stationOf } from '../core/loop.js';

const W = 104;
const H = 44;
/** Top-left of each station, per pattern. A pattern with no layout here gets no drawing. */
export const LAYOUTS = Object.freeze({
  'build-until-green@1': {
    view: [1240, 356],
    at: {
      plan: [16, 24], recipe: [148, 24], goalcheck: [856, 24], pr: [988, 24], end: [1120, 24],
      tests: [24, 136], build: [164, 136], taskcheck: [292, 136], featurecheck: [440, 136], review: [568, 136], merge: [696, 136], goalblame: [856, 136],
      doubt: [164, 236], fixer: [292, 236], blame: [440, 236], suite: [696, 236],
    },
    frames: { feature: [8, 84, 804, 264], task: [148, 112, 264, 184] },
    /** Each edge as points: [station, side, offset] anchors or plain [x, y]. */
    paths: {
      'plan>recipe': [['plan', 'r'], ['recipe', 'l']],
      'recipe>tests': [['recipe', 'b', -20], [180, 100], [76, 100], ['tests', 't']],
      'tests>build': [['tests', 'r'], ['build', 'l']],
      'build>taskcheck': [['build', 'r'], ['taskcheck', 'l']],
      'taskcheck>fixer': [['taskcheck', 'b', 18], ['fixer', 't', 18]],
      'fixer>taskcheck': [['fixer', 't', -18], ['taskcheck', 'b', -18]],
      'fixer>doubt': [['fixer', 'l'], ['doubt', 'r']],
      'doubt>build': [['doubt', 't'], ['build', 'b']],
      'taskcheck>build': [['taskcheck', 't'], [344, 124], [216, 124], ['build', 't']],
      'taskcheck>featurecheck': [['taskcheck', 'r'], ['featurecheck', 'l']],
      'taskcheck>suite': [['taskcheck', 'r', 14], [424, 172], [424, 292], [748, 292], ['suite', 'b']],
      'featurecheck>blame': [['featurecheck', 'b', 18], ['blame', 't', 18]],
      'blame>fixer': [['blame', 'l'], ['fixer', 'r']],
      'featurecheck>review': [['featurecheck', 'r'], ['review', 'l']],
      'review>build': [['review', 'b'], [620, 318], [156, 318], [156, 170], ['build', 'l', 12]],
      'review>merge': [['review', 'r'], ['merge', 'l']],
      'merge>suite': [['merge', 'b'], ['suite', 't']],
      'merge>goalcheck': [['merge', 't'], [748, 46], ['goalcheck', 'l']],
      'goalcheck>goalblame': [['goalcheck', 'b', 18], ['goalblame', 't', 18]],
      'goalblame>fixer': [['goalblame', 'b'], [908, 338], [344, 338], ['fixer', 'b']],
      'goalcheck>pr': [['goalcheck', 'r'], ['pr', 'l']],
      'pr>end': [['pr', 'r'], ['end', 'l']],
    },
  },
});

const MARK_SIGN = Object.freeze({ done: '✓', current: '●', blocked: '■', gate: '▲', stopped: '○', idle: '' });
const MARK_WORD = Object.freeze({ done: 'done', current: 'here now', blocked: 'blocked here', gate: 'waits for you', stopped: 'stopped here', idle: '' });

function anchor(layout, p) {
  if (typeof p[0] === 'number') return p;
  const [id, side, d = 0] = p;
  const [x, y] = layout.at[id];
  if (side === 'r') return [x + W, y + H / 2 + d];
  if (side === 'l') return [x, y + H / 2 + d];
  if (side === 't') return [x + W / 2 + d, y];
  return [x + W / 2 + d, y + H];
}

/** The points of an edge, or null when the layout has no path for it. */
export function edgePoints(layout, from, to) {
  const p = layout.paths[`${from}>${to}`];
  return p ? p.map((q) => anchor(layout, q)) : null;
}

function labelAt(pts) {
  let best = 0;
  let len = -1;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    if (l > len) { len = l; best = i; }
  }
  const [a, b] = [pts[best], pts[best + 1]];
  const vertical = Math.abs(a[0] - b[0]) < 1;
  return { x: (a[0] + b[0]) / 2 + (vertical ? 4 : 0), y: (a[1] + b[1]) / 2 - (vertical ? 0 : 4), anchor: vertical ? 'start' : 'middle', vertical, len };
}

/** The drawing. Pure apart from the DOM it builds. */
export function loopSvg(pattern, pos, layout = LAYOUTS[pattern.id], open = null) {
  const [vw, vh] = layout.view;
  const s = svg('svg', { class: 'lp-svg', viewBox: `0 0 ${vw} ${vh}`, role: 'img', 'aria-label': `The loop, at ${stationOf(pattern, pos.current)?.label ?? '?'}` });
  const defs = svg('defs');
  for (const k of ['fwd', 'back', 'next', 'side']) {
    const m = svg('marker', { id: `lp-arrow-${k}`, viewBox: '0 0 8 8', refX: '7', refY: '4', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' });
    m.append(svg('path', { d: 'M0 0 L8 4 L0 8 z', class: `lp-head lp-head--${k}` }));
    defs.append(m);
  }
  s.append(defs);
  for (const f of pattern.frames) {
    const box = layout.frames[f.id];
    if (!box) continue;
    const g = svg('g', { class: 'lp-frame' });
    g.append(svg('rect', { x: box[0], y: box[1], width: box[2], height: box[3], rx: 6 }));
    const who = f.id === 'feature' ? pos.focus.feature : f.id === 'task' ? pos.focus.task : null;
    const t = svg('text', { x: box[0] + 8, y: box[1] + box[3] - 7, class: 'lp-frame-t' });
    t.textContent = who ? `${f.label} · ${rnClean(who, 40)}` : f.label;
    g.append(t);
    s.append(g);
  }
  for (const [from, to, kind, label] of pattern.edges) {
    const pts = edgePoints(layout, from, to);
    if (!pts) continue;
    const g = svg('g', { class: `lp-edge lp-edge--${kind}` });
    g.dataset.edge = `${from}>${to}`;
    g.append(svg('polyline', { points: pts.map((p) => p.join(',')).join(' '), 'marker-end': `url(#lp-arrow-${kind})` }));
    if (label) {
      // A label goes on its edge only where it fits; else it is the edge's tooltip.
      const at = labelAt(pts);
      if (at.vertical || at.len >= label.length * 6.2 + 10) {
        const t = svg('text', { x: at.x, y: at.y, 'text-anchor': at.anchor, class: 'lp-edge-t' });
        t.textContent = label;
        g.append(t);
      } else {
        const tip = svg('title');
        tip.textContent = label;
        g.append(tip);
      }
    }
    s.append(g);
  }
  for (const st of pattern.stations) {
    const xy = layout.at[st.id];
    if (!xy) continue;
    const m = pos.stations[st.id] ?? { mark: 'idle' };
    const g = svg('g', { class: `lp-st${st.back ? ' lp-st--back' : ''}${st.side ? ' lp-st--side' : ''}`, transform: `translate(${xy[0]},${xy[1]})` });
    g.dataset.station = st.id;
    g.dataset.mark = m.mark;
    g.dataset.drawer = `station:${st.id}`;
    g.setAttribute('tabindex', '0');
    g.setAttribute('role', 'button');
    g.setAttribute('aria-pressed', String(open === st.id));
    const tip = svg('title');
    tip.textContent = [`${st.label}${MARK_WORD[m.mark] ? ` · ${MARK_WORD[m.mark]}` : ''}`, m.more ?? m.sub, st.text].filter(Boolean).join('\n');
    g.append(tip);
    if (m.mark === 'current' || m.mark === 'blocked') g.append(svg('rect', { class: 'lp-ring', x: -4, y: -4, width: W + 8, height: H + 8, rx: 9 }));
    g.append(svg('rect', { class: 'lp-box', width: W, height: H, rx: 5 }));
    const name = svg('text', { x: 8, y: 18, class: 'lp-st-t' });
    name.textContent = `${MARK_SIGN[m.mark] ? `${MARK_SIGN[m.mark]} ` : ''}${st.label}`;
    g.append(name);
    if (m.sub) {
      const sub = svg('text', { x: 8, y: 34, class: 'lp-st-sub' });
      sub.textContent = rnClean(m.sub, 17) ?? '';
      g.append(sub);
    }
    s.append(g);
  }
  return s;
}

/** The same stations as a list: the phone's view and the drawing's text. */
export function loopList(pattern, pos, open = null) {
  const ol = el('ol', 'lp-list');
  for (const st of pattern.stations) {
    const m = pos.stations[st.id] ?? { mark: 'idle' };
    const li = el('li', `lp-li${st.back ? ' lp-li--back' : ''}${st.side ? ' lp-li--side' : ''}`);
    li.dataset.station = st.id;
    li.dataset.mark = m.mark;
    li.dataset.drawer = `station:${st.id}`;
    li.setAttribute('tabindex', '0');
    li.setAttribute('role', 'button');
    li.setAttribute('aria-pressed', String(open === st.id));
    li.append(el('span', 'lp-li-m', MARK_SIGN[m.mark] || (st.back ? '↺' : st.side ? '·' : '○')), el('span', 'lp-li-t', st.label));
    if (m.sub) li.append(el('span', 'lp-li-sub', rnClean(m.sub, 60)));
    if (MARK_WORD[m.mark] && m.mark !== 'done') li.append(el('span', 'lp-li-w', MARK_WORD[m.mark]));
    ol.append(li);
  }
  return ol;
}

const hm = (ms) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const mins = (ms) => (ms < 60_000 ? `${Math.max(0, Math.round(ms / 1000))} s` : ms < 3_600_000 ? `${(ms / 60_000).toFixed(1)} min` : `${(ms / 3_600_000).toFixed(1)} h`);
const firstSentence = (t) => {
  const s = rnClean(t, 2000) ?? '';
  const m = /^(.{20,280}?[.!?])(\s|$)/.exec(s);
  return m ? m[1] : s.slice(0, 280);
};

/** When the run last changed state (the last run.state event), or null. */
export function sinceOf(events) {
  const e = (events ?? []).filter((x) => x?.type === 'run.state' && typeof x.at === 'number').at(-1);
  return e ? e.at : null;
}

/**
 * The callout: what needs you, in one line, and the one control row.
 * `controls` are runControls() plans; `gates` a node with the open items' buttons, or null.
 */
export function loopCallout(pattern, pos, run, { events = [], controls = [], gates = null, onDone, now = Date.now() } = {}) {
  const box = el('div', 'lp-callout');
  const st = stationOf(pattern, pos.current);
  const since = sinceOf(events);
  const sinceText = since ? ` · since ${hm(since)} · ${mins(now - since)}` : '';
  const where = [st?.label, pos.node].filter(Boolean).map((x) => rnClean(x, 48)).join(' · ');
  let mark = 'current';
  if (run?.state === 'done') {
    mark = 'done';
    box.append(el('p', 'lp-now', `✓ Done${run.stop && run.stop !== 'done' ? ` · ${rnClean(run.stop, 32)}` : ''}`));
  } else if (run?.state === 'stopped') {
    mark = 'stopped';
    box.append(el('p', 'lp-now', `Stopped at ${where}${run.stop ? ` · ${rnClean(run.stop, 32)}` : ''}`));
    const why = pattern.stops[run.stop];
    if (why) box.append(el('p', 'lp-hint', `${rnClean(run.stop, 32)}: ${why}.`));
  } else if (pos.blocked) {
    mark = 'blocked';
    box.append(el('p', 'lp-now', `■ Stopped at ${where}${sinceText}`));
    const why = el('div', 'lp-why');
    why.append(el('span', 'lp-k', 'What is wrong'), el('span', 'lp-t', firstSentence(run.reason) || 'It stopped and waits for you.'));
    if ((rnClean(run.reason, 2000) ?? '').length > firstSentence(run.reason).length) {
      const d = el('details', 'lp-full rn-keep');
      d.dataset.keep = 'reason';
      d.append(el('summary', null, 'full text'), el('p', null, rnClean(run.reason, 2000)));
      why.append(d);
    }
    box.append(why, el('p', 'lp-hint', 'Nothing to approve. Fix the cause, then Resume: the foreman tries this step again.'));
  } else if (gates || run?.state === 'waiting-approval') {
    mark = 'gate';
    box.append(el('p', 'lp-now', `▲ ${run?.state === 'waiting-approval' ? 'The recipe waits for you' : 'A decision waits for you'}`));
    if (gates) box.append(gates);
  } else if (pos.openRound) {
    const r = pos.openRound;
    const ago = typeof r.at === 'number' ? ` · ${mins(now - r.at)} so far` : '';
    box.append(el('p', 'lp-now', `● Now · ${[r.role, r.tier].map((x) => rnClean(x, 24)).filter(Boolean).join(' · ')} · ${typeof r.round === 'number' ? `round ${r.round} ` : ''}on ${rnClean(r.node, 48) ?? '?'}${ago}`));
  } else {
    box.append(el('p', 'lp-now', `${run?.state === 'paused' ? '‖ Paused at' : run?.state === 'queued' ? '… Queued at' : '● At'} ${where}`));
  }
  box.dataset.mark = mark;
  const plans = controls.filter((c) => !(mark === 'blocked' && c.word === 'pause'));
  if (plans.length) {
    const row = el('p', 'lp-btns');
    for (const plan of plans) {
      const b = decisionButton(plan, onDone);
      if (plan.word === 'resume') b.classList.add('btn--primary', 'lp-go');
      else if (plan.word === 'stop') b.classList.add('lp-quiet');
      row.append(b);
    }
    box.append(row);
  }
  return box;
}

/** Where the pattern came from and the numbers it runs with, in one grey line. */
function patternLine(pattern, from, params) {
  const p = el('p', 'lp-pattern');
  const nums = `${params.task_rounds.value} rounds a task · a tier up after ${params.escalate_after.value} · ${params.review_cycles.value} reviews`;
  const src = params.task_rounds.from === 'recipe' ? 'from the recipe' : 'pattern defaults';
  p.append(el('span', null, pattern.id), el('span', null, from === 'kind' ? 'by the run kind (foundry does not name the pattern yet)' : 'named by the recipe'), el('span', null, `${nums} (${src})`));
  return p;
}

/**
 * The loop section of a run page. `ctx`: {events, controls, gates, onDone, now}.
 * A run with no known pattern gets a note and no drawing: a wrong drawing is worse than none.
 */
export function loopSection(run, ctx = {}) {
  const sec = el('section', 'rn-sec lp');
  sec.setAttribute('aria-label', 'The loop');
  const { pattern, from, why } = patternOf(run);
  if (!pattern || !LAYOUTS[pattern.id]) {
    sec.dataset.mark = 'none';
    sec.append(el('p', 'lp-none', `No loop drawing: ${why ?? 'laneboard has no drawing for this pattern'}. The tree below is the plan.`));
    const plans = ctx.controls ?? [];
    if (plans.length || ctx.gates) {
      const fake = { stations: {}, current: null, focus: {}, blocked: blockedRun(run), openRound: null };
      sec.append(loopCallout({ stations: [], stops: {} }, fake, run, ctx));
    }
    return sec;
  }
  const params = paramsOf(run, pattern);
  const pos = loopPosition(run, ctx.events ?? [], pattern, params);
  if (ctx.page) ctx.page.pos = pos;
  const open = ctx.page?.drawer?.kind === 'station' ? ctx.page.drawer.id : null;
  const callout = loopCallout(pattern, pos, run, ctx);
  sec.dataset.mark = callout.dataset.mark;
  sec.dataset.station = pos.current;
  const draw = el('div', 'lp-draw');
  draw.append(loopSvg(pattern, pos, LAYOUTS[pattern.id], open), loopList(pattern, pos, open));
  sec.append(draw, callout, patternLine(pattern, from, params));
  if (!pos.exact && pos.current !== 'end') {
    sec.append(el('p', 'lp-pattern lp-guess', 'The spot is worked out from the events: foundry does not send each node\'s phase yet.'));
  }
  return sec;
}
