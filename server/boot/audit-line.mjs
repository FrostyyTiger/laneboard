// The startup line for an audit log the builder could not open. api-v1's
// initV1 logs only the code (`AUDIT_UNSAFE_DIR`), which tells nobody what to
// change; the reason is in the error's message (fleet/audit.mjs), so this line
// puts the two side by side. A held lock keeps bootErrorLine's own line.
import { bootErrorLine } from './common.mjs';

/** One line for an audit-open error (any `AUDIT_*` code), or null for any other error. */
export function auditErrorLine(err) {
  const boot = bootErrorLine(err);
  if (boot) return boot;
  const code = String(err?.code || '');
  if (!code.startsWith('AUDIT_')) return null;
  const msg = String(err.message || '').replace(/\s+/g, ' ').trim();
  return `laneboard: ${msg || 'the audit log could not be opened'} (${code}); every action is refused until it is fixed`;
}
