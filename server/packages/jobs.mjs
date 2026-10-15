// Per-job CI verdict (fleet §6 2.4, P4). Pure.
//
// A job can be green while its real work did not run: step-level
// `if: needs.changes.outputs.<flag> == 'true'` (or a dorny filter step) skips
// every working step and GitHub still reports the job `success`. Calling that
// green would claim a package was tested on a commit where only checkout ran.
//
// jobVerdict(job) -> {verdict:'ok'|'fail'|'running'|'queued'|'not-run', partial, skippedNames}
//   - job conclusion `skipped` (job-level `if:` false)            -> not-run
//   - completed with a failure-class conclusion (checkBucket)      -> fail
//   - not completed: queued/waiting/pending/requested -> queued, else running
//   - every working (non-setup) step skipped                       -> not-run
//   - some working steps skipped                                   -> ok, partial, skippedNames
//   - otherwise                                                    -> ok
// `job.steps` is either gh's raw step list ([{name, status, conclusion}]) or the
// summary `runJobs` returns ({total, ran, skipped, failed, skippedNames}, where
// `ran`/`skipped` already exclude setup steps).
import { checkBucket, SETUP_STEP } from '../providers/ci/gh.mjs';

export const VERDICTS = Object.freeze(['ok', 'fail', 'running', 'queued', 'not-run']);

// gh's names for setup steps, plus `uses:` of checkout/setup/cache steps with no name of their own.
const SETUP_EXTRA = /^(Run|Post Run) (actions\/(checkout|setup-[\w-]+|cache)|[\w.-]+\/setup-[\w-]+)(@.*)?$/;

/** Is this step only preparing the job (checkout, setup-*, cache, job bookkeeping)? */
export function isSetupStep(name) {
  const n = String(name ?? '');
  return SETUP_STEP.test(n) || SETUP_EXTRA.test(n);
}

const QUEUED = new Set(['queued', 'waiting', 'pending', 'requested']);
const lower = (v) => (v == null ? '' : String(v).toLowerCase());

/** Working steps of a job: `{ran, skipped, skippedNames}`, or null when steps are unknown. */
export function workSteps(steps) {
  if (Array.isArray(steps)) {
    const work = steps.filter((s) => s && !isSetupStep(s.name));
    const skippedNames = work.filter((s) => lower(s.conclusion) === 'skipped').map((s) => String(s.name ?? ''));
    return { ran: work.length, skipped: skippedNames.length, skippedNames };
  }
  if (steps && typeof steps === 'object' && Number.isFinite(Number(steps.ran))) {
    // runJobs' summary: `ran`, `skipped` and `skippedNames` already exclude setup steps.
    const skippedNames = Array.isArray(steps.skippedNames) ? steps.skippedNames.map(String) : [];
    const skipped = Number.isFinite(Number(steps.skipped)) ? Number(steps.skipped) : skippedNames.length;
    return { ran: Number(steps.ran), skipped, skippedNames };
  }
  return null;
}

/** One job of a run -> its verdict. See the header for the rule. */
export function jobVerdict(job) {
  const status = lower(job?.status);
  const conclusion = lower(job?.conclusion);
  const plain = (verdict) => ({ verdict, partial: false, skippedNames: [] });

  if (conclusion === 'skipped') return plain('not-run');
  if (status && status !== 'completed') return plain(QUEUED.has(status) ? 'queued' : 'running');
  if (!status && !conclusion) return plain('queued');

  const bucket = checkBucket({ status: 'COMPLETED', conclusion });
  if (bucket === 'failed') return plain('fail');
  if (bucket !== 'passed') return plain('queued'); // completed without a conclusion we know

  const w = workSteps(job?.steps);
  if (!w || w.ran === 0) return plain('ok');
  if (w.skipped >= w.ran) return { verdict: 'not-run', partial: false, skippedNames: w.skippedNames };
  if (w.skipped > 0) return { verdict: 'ok', partial: true, skippedNames: w.skippedNames };
  return plain('ok');
}

/** Did this job actually test something (for `lastTested`)? ok, partial or not. */
export const tested = (v) => (typeof v === 'string' ? v : v?.verdict) === 'ok';

/** A run's jobs with `verdict`, `partial`, `skippedNames` added (input untouched). */
export function withVerdicts(jobs) {
  return (Array.isArray(jobs) ? jobs : []).map((j) => ({ ...j, ...jobVerdict(j) }));
}
