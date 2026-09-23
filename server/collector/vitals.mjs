// Host vitals: CPU, memory, swap, load, disk, GPU, aggregate Claude RSS.
import fsp from 'node:fs/promises';
import os from 'node:os';
import { run } from '../util.mjs';
import { config } from '../config.mjs';

let prevCpu = null;
let gpu = null;
let gpuAt = 0;
let disk = null;
let diskAt = 0;
const DISK_MS = 30000;

async function cpuPercent() {
  let stat;
  try { stat = await fsp.readFile('/proc/stat', 'utf8'); } catch { return null; }
  const line = stat.split('\n', 1)[0];
  const nums = line.trim().split(/\s+/).slice(1).map(Number);
  const idle = nums[3] + (nums[4] || 0);
  const total = nums.reduce((a, b) => a + b, 0);
  const prev = prevCpu;
  prevCpu = { idle, total };
  if (!prev) return null;
  const dTotal = total - prev.total;
  const dIdle = idle - prev.idle;
  if (dTotal <= 0) return null;
  return Math.round(((dTotal - dIdle) / dTotal) * 1000) / 10;
}

async function memory() {
  let text;
  try { text = await fsp.readFile('/proc/meminfo', 'utf8'); } catch { return null; }
  const kv = {};
  for (const line of text.split('\n')) {
    const m = /^(\w+):\s+(\d+) kB/.exec(line);
    if (m) kv[m[1]] = Number(m[2]);
  }
  return {
    totalMb: Math.round(kv.MemTotal / 1024),
    availableMb: Math.round(kv.MemAvailable / 1024),
    usedMb: Math.round((kv.MemTotal - kv.MemAvailable) / 1024),
    swapTotalMb: Math.round(kv.SwapTotal / 1024),
    swapUsedMb: Math.round((kv.SwapTotal - kv.SwapFree) / 1024),
  };
}

async function loadAvg() {
  try {
    const [a, b, c] = (await fsp.readFile('/proc/loadavg', 'utf8')).split(' ');
    return [Number(a), Number(b), Number(c)];
  } catch { return null; }
}

async function readDisk() {
  // Free space does not move fast enough to justify a df every 2 s tick.
  if (Date.now() - diskAt < DISK_MS) return disk;
  diskAt = Date.now();
  const r = await run('df', ['-BM', '--output=size,used,avail,pcent', config.home], { timeout: 3000 });
  if (!r.ok) return disk;
  const line = r.stdout.trim().split('\n').pop().trim().split(/\s+/);
  disk = {
    sizeMb: Number(line[0].replace('M', '')),
    usedMb: Number(line[1].replace('M', '')),
    availMb: Number(line[2].replace('M', '')),
    usedPct: Number(line[3].replace('%', '')),
  };
  return disk;
}

async function readGpu() {
  if (Date.now() - gpuAt < config.vitalsGpuMs) return gpu;
  gpuAt = Date.now();
  const r = await run('nvidia-smi', ['--query-gpu=memory.used,memory.total,utilization.gpu', '--format=csv,noheader,nounits'], { timeout: 4000 });
  if (!r.ok) { gpu = null; return null; }
  const [usedMb, totalMb, util] = r.stdout.trim().split(',').map((s) => Number(s.trim()));
  gpu = { memUsedMb: usedMb, memTotalMb: totalMb, utilPct: util };
  return gpu;
}

/** claudeRssKb: sum of RSS over the live claude processes we know about. */
export async function sample({ claudeRssKb = 0, sessionCount = 0 } = {}) {
  const [cpu, mem, load, dsk, g] = await Promise.all([cpuPercent(), memory(), loadAvg(), readDisk(), readGpu()]);
  return {
    at: Date.now(),
    host: config.hostname,
    cpuPct: cpu,
    mem,
    load,
    disk: dsk,
    gpu: g,
    claudeRssMb: Math.round(claudeRssKb / 1024),
    sessionCount,
    laneboardRssMb: Math.round(process.memoryUsage.rss() / 1024 / 1024),
  };
}
