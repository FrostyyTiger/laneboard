// No CI provider: no PR chips on the lane cards, no queue on the Box, no
// per-job CI on the Packages view.
//
// A lane still shows its branch and its progress; it just says nothing about
// what a forge thinks of it.
export const name = 'none';
export const active = false;

export async function prForBranch() { return { none: true }; }
export async function runs() { return { ok: false }; }
export async function mainRuns() { return { ok: false }; }
export async function runJobs() { return { ok: false }; }
export async function rateLimit() { return { ok: false }; }
export async function failedJobsForCommit() { return []; }
