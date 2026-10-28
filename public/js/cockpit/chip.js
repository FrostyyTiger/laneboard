// The context chip above the input row (cockpit spec c3-see.md §9 "The chip", c1-talk.md §1.1;
// D65, D133). DOM only, no innerHTML: every text goes in as textContent.
//
//   const chips = createChipRow({ doc, onChange });
//   chips.node                    the 64 px row `.ck-chiprow`, hidden while no chip shows
//   chips.set({ id, label, kind }) one chip at a time (D65): a second replaces the first;
//                                 false (nothing drawn) without an id
//   chips.clear()                 what the chip's `✕` does
//   chips.current()               { id, label, kind } or null
//   onChange()                    the chip came or went: the pane lays the stack out again
//
// C1 builds the row and its `✕` for the stack of c1-talk.md §1.1 (S-C1-34, build B245); what puts
// a chip there (`ASK ABOUT THIS`, c3-see.md §9.3) and what a send does with it (S-C3-11) are C3's.

const el = (doc, tag, cls, attrs = {}) => {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

/** A chip from what the caller gives: an id is needed, the label falls back to it. */
export function chipFrom(x) {
  const id = typeof x?.id === 'string' ? x.id : '';
  if (id === '') return null;
  const label = typeof x.label === 'string' && x.label !== '' ? x.label : id;
  const kind = typeof x.kind === 'string' ? x.kind : '';
  return { id, label, kind };
}

export function createChipRow(opts = {}) {
  const doc = opts.doc ?? document;
  const onChange = opts.onChange ?? (() => {});

  const node = el(doc, 'div', 'ck-chiprow');
  node.hidden = true;
  let chip = null;

  function clear() {
    if (chip === null) return;
    chip = null;
    node.textContent = '';
    node.hidden = true;
    onChange();
  }

  /**
   * c3-see.md §9: `ABOUT`, 12 px, the label (cut with `…`), 12 px, the kind, then the 48x48
   * `✕` flush with the chip's right edge.
   */
  function set(x) {
    const c = chipFrom(x);
    if (c === null) return false;
    chip = c;
    const box = el(doc, 'div', 'ck-chip', { 'data-cockpit-chip': '', 'data-node': c.id });
    const about = el(doc, 'span', 'ck-chip-about');
    about.textContent = 'ABOUT';
    const label = el(doc, 'span', 'ck-chip-label');
    label.textContent = c.label;
    box.append(about, label);
    if (c.kind !== '') {
      const kind = el(doc, 'span', 'ck-chip-kind');
      kind.textContent = c.kind;
      box.append(kind);
    }
    const remove = el(doc, 'button', 'ck-chip-remove', {
      type: 'button', 'data-cockpit-chip-remove': '', 'aria-label': 'Remove context',
    });
    remove.textContent = '✕';
    remove.addEventListener('click', clear);
    box.append(remove);
    node.textContent = '';
    node.append(box);
    node.hidden = false;
    onChange();
    return true;
  }

  return { node, set, clear, current: () => (chip ? { ...chip } : null) };
}
