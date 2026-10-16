// The running version, read once from package.json so /healthz, the v1 hello
// and the release tag can never disagree. No other imports: both boot paths
// (builder and hub) and any module may use it without pulling in a collector.
import fs from 'node:fs';
import path from 'node:path';

export const VERSION = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, '..', 'package.json'), 'utf8')
).version;

export default VERSION;
