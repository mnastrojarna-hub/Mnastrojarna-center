// Process helpers of the harness: run a Node child under a memory / time watchdog (RSS from /proc/<pid>/status every
// 250 ms – a long synchronous OCCT call cannot block it), collect "@@{json}" event lines from its stdout.
// A watched child never outlives its bench: the parent kills its children on SIGTERM / SIGINT / SIGHUP and on exit, and
// the child (exitWithParent) watches the parent from a worker thread, so even a SIGKILL of the parent (no handler runs)
// takes the child down within ~0.5 s – also while the child's main thread is stuck in a long synchronous OCCT call.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { Worker } from "node:worker_threads";

/** VmRSS / VmHWM (peak) of a process in MB, null when the process is gone or /proc is missing */
export function procMem(pid = "self") {
  try {
    const s = fs.readFileSync(`/proc/${pid}/status`, "utf8");
    const g = (k) => Number(new RegExp(`${k}:\\s+(\\d+) kB`).exec(s)?.[1] ?? 0) / 1024;
    return { rss: g("VmRSS"), hwm: g("VmHWM") };
  } catch {
    return null;
  }
}

/** emit one event line for the parent */
export const emit = (o) => process.stdout.write(`@@${JSON.stringify(o)}\n`);

/** true while the process exists and is not a zombie (a killed orphan stays a zombie until PID 1 reaps it) */
export function alive(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3) !== "Z";
  } catch {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
}

/** children of runWatched that are still running (killed when this process is terminated or exits) */
const live = new Set();
let hooked = false;
function hookParentSignals() {
  if (hooked) return;
  hooked = true;
  const killAll = () => {
    for (const p of live) {
      try {
        p.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }
  };
  process.on("exit", killAll);
  for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"])
    process.on(sig, () => {
      killAll();
      process.exit(128 + (os.constants.signals[sig] ?? 15));
    });
}

/**
 * Child side: SIGKILL this process as soon as its parent is gone (re-parented to PID 1 / a subreaper, or the parent PID
 * no longer exists). Runs in a worker thread, so it works while the main thread is blocked in a synchronous WASM call.
 */
export function exitWithParent(intervalMs = 250) {
  const w = new Worker(
    // process.ppid is a value fixed at start-up; the live parent PID is field 4 of /proc/<pid>/stat. getBuiltinModule
    // instead of require/import: the eval code runs as CommonJS or as ESM depending on the flags of the process
    `const { workerData: d } = process.getBuiltinModule("node:worker_threads");
     const fs = process.getBuiltinModule("node:fs");
     const ppid = () => { try { const s = fs.readFileSync("/proc/" + d.pid + "/stat", "utf8"); return Number(s.slice(s.lastIndexOf(")") + 2).split(" ")[1]); } catch { return null; } };
     const gone = () => { const p = ppid(); if (p !== null) return p !== d.ppid; try { process.kill(d.ppid, 0); return false; } catch { return true; } };
     setInterval(() => { if (gone()) process.kill(d.pid, "SIGKILL"); }, d.ms);`,
    { eval: true, execArgv: [], workerData: { ppid: process.ppid, pid: process.pid, ms: intervalMs } },
  );
  w.unref();
  return w;
}

/**
 * Spawn `cmd args` (default: this Node binary) and watch it. Resolves when the child exits:
 * { code, signal, aborted, events, stdout, peakRssMB, wallMs }. `aborted` names the guard that killed it.
 */
export function runWatched(args, { cmd = process.execPath, maxRss = 3000, timeoutS = 900, onEvent, env } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    hookParentSignals();
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "inherit"], env: env ?? process.env });
    live.add(p);
    const events = [];
    let stdout = "";
    let peak = 0;
    let aborted = null;
    let buf = "";
    p.stdout.on("data", (d) => {
      stdout += d;
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (!line.startsWith("@@")) continue;
        try {
          const ev = JSON.parse(line.slice(2));
          events.push(ev);
          onEvent?.(ev);
        } catch {
          /* not an event */
        }
      }
    });
    const sample = () => {
      const st = procMem(p.pid);
      if (st) peak = Math.max(peak, st.rss, st.hwm);
      if (!aborted && peak > maxRss) aborted = `memory guard: RSS ${Math.round(peak)} MB > ${maxRss} MB`;
      if (!aborted && Date.now() - t0 > timeoutS * 1000) aborted = `timeout ${timeoutS} s`;
      if (aborted) p.kill("SIGKILL");
    };
    const timer = setInterval(sample, 250);
    p.on("exit", (code, signal) => {
      live.delete(p);
      clearInterval(timer);
      resolve({ code, signal, aborted, events, stdout, peakRssMB: Math.round(peak), wallMs: Date.now() - t0 });
    });
  });
}

export const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
};
