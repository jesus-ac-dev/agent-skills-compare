import { NextRequest, NextResponse } from 'next/server';
import { getStatus, startRun, cancelRun, addListener, removeListener, getCurrentRun } from '@/lib/pipeline-registry';

// NOTE: This API is currently local-dev only.
// Authentication must be added before deploying to production.

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  if (url.searchParams.has('stream')) {
    const current = getCurrentRun();
    if (!current) {
      return NextResponse.json({ error: 'No run in progress' }, { status: 404 });
    }
    return createStreamResponse(req, current);
  }
  return NextResponse.json(getStatus());
}

export async function DELETE() {
  cancelRun();
  return new NextResponse(null, { status: 204 });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { query, resumeOnly } = body ?? {};

  if (resumeOnly) {
    if (query) {
      return NextResponse.json({ error: 'resumeOnly cannot be combined with query' }, { status: 400 });
    }
  } else if (!query || typeof query !== 'string' || query.length < 1 || query.length > 200) {
    return NextResponse.json({ error: 'Invalid query' }, { status: 400 });
  }

  const current = getStatus();
  if (current.running) {
    return NextResponse.json(current, { status: 409 });
  }

  const run = startRun(resumeOnly ? { resumeOnly: true } : { query });
  return createStreamResponse(req, run);
}

function createStreamResponse(req: NextRequest, run: ReturnType<typeof startRun>) {
  const stream = new ReadableStream({
    start(controller) {
      addListener();

      const onLog = (msg: string) => {
        const lines = msg.split('\n');
        for (const line of lines) {
          if (line.trim()) {
            controller.enqueue(`data: ${line}\n\n`);
          }
        }
      };

      const onDone = (code: number | null) => {
        controller.enqueue(`event: done\ndata: ${code ?? 0}\n\n`);
        cleanup();
        controller.close();
      };

      const onError = (err: Error) => {
        controller.enqueue(`event: error\ndata: ${err.message}\n\n`);
        cleanup();
        controller.close();
      };

      const cleanup = () => {
        run.emitter.off('log', onLog);
        run.emitter.off('done', onDone);
        run.emitter.off('error', onError);
        removeListener();
      };

      run.emitter.on('log', onLog);
      run.emitter.on('done', onDone);
      run.emitter.on('error', onError);

      req.signal.addEventListener('abort', () => {
        cleanup();
      });
    },
    cancel() {
      removeListener();
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
