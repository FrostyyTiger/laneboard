// No CI provider: no PR chips on the lane cards, no queue on the Box.
//
// A lane still shows its branch and its progress; it just says nothing about
// what a forge thinks of it.
export const name = 'none';
export const active = false;

export async function prForBranch() { return { none: true }; }
export async function runs() { return { ok: false }; }
