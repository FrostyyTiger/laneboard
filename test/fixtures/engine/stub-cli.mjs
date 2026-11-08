// A stand-in engine CLI for test/engine-contract.test.mjs (exec.mjs):
//   echo <args…>   prints {args, home} as JSON (what argv and env it got)
//   hello          prints the published hello answer
//   hang           never exits
//   big            prints 5 MiB
//   exit <n>       exits with code n (1 if not given), printing nothing
//   refuse         prints the published `refused` result and exits 5
//   (nothing)      does nothing, exits 0
import fs from 'node:fs';
import path from 'node:path';

const [mode, ...rest] = process.argv.slice(2);
const fixture = (name) => fs.readFileSync(path.join(import.meta.dirname, 'v1', name), 'utf8');

switch (mode) {
  case 'echo':
    process.stdout.write(JSON.stringify({ args: rest, home: process.env.HOME ?? null }));
    break;
  case 'hello':
    process.stdout.write(fixture('hello.json'));
    break;
  case 'hang':
    setInterval(() => {}, 1000);
    break;
  case 'big':
    process.stdout.write('x'.repeat(5 * 1024 * 1024));
    break;
  case 'exit':
    process.exitCode = Number(rest[0] ?? 1);
    break;
  case 'refuse':
    process.stdout.write(fixture('result-refused.json'));
    process.exitCode = 5;
    break;
  case undefined:
    // `node --test` runs every .mjs under test/: with no mode this is a no-op.
    break;
  default:
    process.exitCode = 1;
}
