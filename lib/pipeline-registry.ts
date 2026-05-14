import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import path from 'path';

// Path segments live outside spawn() and as separate string tokens so
// Turbopack's static analyzer doesn't treat the literal "src/index.js"
// as a server-relative import target.
const PIPELINE_ENTRYPOINT = ['src', 'index.js'];

interface PipelineRun {
  child: ChildProcess;
  query: string;
  resumeOnly: boolean;
  repoId: number | null;
  startedAt: string;
  runId: string;
  emitter: EventEmitter;
}

export interface StartRunOptions {
  query?: string;
  resumeOnly?: boolean;
  repoId?: number;
  force?: boolean;
}

let currentRun: PipelineRun | null = null;
let listenerCount = 0;
let killTimeout: NodeJS.Timeout | null = null;

export function getStatus() {
  if (!currentRun) return { running: false };
  return {
    running: true,
    query: currentRun.query,
    resumeOnly: currentRun.resumeOnly,
    repoId: currentRun.repoId,
    startedAt: currentRun.startedAt,
    runId: currentRun.runId,
  };
}

export function startRun(opts: StartRunOptions) {
  if (currentRun) {
    return currentRun;
  }

  const scriptPath = path.join(process.cwd(), ...PIPELINE_ENTRYPOINT);
  const childArgs: string[] = [scriptPath];
  if (typeof opts.repoId === 'number') {
    childArgs.push(`--repo-id=${opts.repoId}`);
    if (opts.force) childArgs.push('--force');
  } else if (opts.resumeOnly) {
    childArgs.push('--resume');
  } else if (opts.query) {
    childArgs.push(opts.query);
  }

  const child = spawn('node', childArgs, {
    cwd: process.cwd(),
    env: { ...process.env }
  });
  const emitter = new EventEmitter();

  const run: PipelineRun = {
    child,
    query:
      typeof opts.repoId === 'number'
        ? `(single repo #${opts.repoId})`
        : opts.resumeOnly
          ? '(resume only)'
          : (opts.query ?? ''),
    resumeOnly: !!opts.resumeOnly,
    repoId: typeof opts.repoId === 'number' ? opts.repoId : null,
    startedAt: new Date().toISOString(),
    runId: Math.random().toString(36).substring(7),
    emitter,
  };

  currentRun = run;

  child.stdout?.on('data', (data) => {
    emitter.emit('log', data.toString());
  });

  child.stderr?.on('data', (data) => {
    emitter.emit('log', data.toString());
  });

  child.on('exit', (code) => {
    emitter.emit('done', code);
    if (currentRun?.runId === run.runId) {
      currentRun = null;
    }
  });

  child.on('error', (err) => {
    emitter.emit('error', err);
    if (currentRun?.runId === run.runId) {
      currentRun = null;
    }
  });

  return run;
}

export function cancelRun() {
  if (currentRun) {
    const child = currentRun.child;
    child.kill('SIGTERM');
    const killTimer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch (e) {}
    }, 5000);

    child.on('exit', () => clearTimeout(killTimer));
    // currentRun is cleared by the exit handler in startRun, not here —
    // a new run cannot be started while the previous child is still alive.
  }
}

export function addListener() {
  listenerCount++;
  if (killTimeout) {
    clearTimeout(killTimeout);
    killTimeout = null;
  }
}

export function removeListener() {
  listenerCount--;
  if (listenerCount <= 0 && currentRun) {
    killTimeout = setTimeout(() => {
      if (listenerCount <= 0 && currentRun) {
        cancelRun();
      }
    }, 1000);
  }
}

export function getCurrentRun() {
  return currentRun;
}
