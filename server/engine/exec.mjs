// How an engine's CLI is called (engine.md §4). The `foundry-cli` adapter
// (phase 9) is `createContractEngine` with a `call` built on this; nothing
// in phase 0 calls a real engine.
//
//   - execFile, never a shell: the binary and a fixed argument list per verb,
//     so nothing from a page or an engine answer is ever parsed as a command;
//   - a timeout (`engine.timeoutMs`, default 10 s) and SIGKILL after it;
//   - an output cap (4 MiB, contract.mjs MAX_ANSWER): more is an error, not
//     a truncated answer;
//   - a working directory from config, and only the environment it is given.
//
// The CLI's exit codes (contract v1 "Result"): 0 ok; 2 not-found (also for a
// read of something that does not exist); 3-6 a refusal whose envelope is on
// stdout; 1 engine-error. A refusal with an envelope resolves like a success:
// the adapter reads the code from the envelope.
import { execFile } from 'node:child_process';
import { MAX_ANSWER } from './contract.mjs';

const REFUSAL_EXITS = new Set([2, 3, 4, 5, 6]);

/**
 * Run `bin args…` and resolve its stdout. Rejects with an Error whose `code`
 * is `timeout`, `too-large`, `not-found` (exit 2 without an envelope),
 * `exit` (any other non-zero exit) or the spawn error's own (`ENOENT`).
 */
export function execJson(bin, args, { timeoutMs = 10_000, maxBytes = MAX_ANSWER, cwd, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    if (typeof bin !== 'string' || !bin || !Array.isArray(args) || args.some((a) => typeof a !== 'string')) {
      reject(Object.assign(new Error('bad command'), { code: 'bad-command' }));
      return;
    }
    execFile(bin, args, {
      shell: false, timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: maxBytes, cwd, env, windowsHide: true, encoding: 'utf8',
    }, (err, stdout) => {
      if (!err) { resolve(stdout); return; }
      if (err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
        reject(Object.assign(new Error(`answer over ${maxBytes} bytes`), { code: 'too-large' }));
      } else if (err.killed || err.signal === 'SIGKILL') {
        reject(Object.assign(new Error(`no answer within ${timeoutMs} ms`), { code: 'timeout' }));
      } else if (typeof err.code === 'number') {
        // A refusal still carries its envelope on stdout: let the adapter read it.
        if (REFUSAL_EXITS.has(err.code) && stdout.trim().startsWith('{')) { resolve(stdout); return; }
        reject(Object.assign(new Error(`exited ${err.code}`), { code: err.code === 2 ? 'not-found' : 'exit', exitCode: err.code }));
      } else {
        reject(Object.assign(new Error(err.message.split('\n')[0]), { code: err.code ?? 'spawn' }));
      }
    });
  });
}
