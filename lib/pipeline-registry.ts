import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import path from 'path';

interface PipelineRun {
  child: ChildProcess;
  query: string;
  startedAt: string;
  runId: string;
  emitter: EventEmitter;
}

let currentRun: PipelineRun | null = null;
let listenerCount = 0;
let killTimeout: NodeJS.Timeout | null = null;

export function getStatus() {
  if (!currentRun) return { running: false };
  return {
    running: true,
    query: currentRun.query,
    startedAt: currentRun.startedAt,
    runId: currentRun.runId,
  };
}

export function startRun(query: string) {
  if (currentRun) {
    return currentRun;
  }

  const child = spawn('node', [path.join(process.cwd(), 'src/index.js'), query], {
    cwd: process.cwd(),
    env: { ...process.env }
  });
  const emitter = new EventEmitter();

  const run: PipelineRun = {
    child,
    query,
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

    currentRun = null;
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
