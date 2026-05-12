'use client';

import { useState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Play, XCircle, Trash2, Loader2, AlertCircle, RotateCw } from 'lucide-react';
import { useResumable } from '@/lib/use-resumable';

type RunStatus = 'idle' | 'running' | 'done (exit 0)' | 'failed' | 'cancelled' | 'quota-exceeded' | string;

interface RunInfo {
  running: boolean;
  query?: string;
  resumeOnly?: boolean;
  startedAt?: string;
  runId?: string;
}

interface StartStreamingOpts {
  attach?: boolean;
  payload?: { query?: string; resumeOnly?: boolean };
}

export default function RunPage() {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<RunStatus>('idle');
  const [logs, setLogs] = useState<string[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);
  const logContainerRef = useRef<HTMLPreElement>(null);
  const [isAutoScroll, setIsAutoScroll] = useState(true);
  const abortControllerRef = useRef<AbortController | null>(null);
  const { count: resumableCount, refetch: refetchResumable } = useResumable();

  useEffect(() => {
    const checkStatus = async () => {
      try {
        const res = await fetch('/api/pipeline');
        const data: RunInfo = await res.json();
        if (data.running) {
          setStatus('running');
          setQuery(data.query || '');
          startStreaming({ attach: true });
        }
      } catch (err) {
        console.error('Failed to check status:', err);
      }
    };

    checkStatus();
    return () => {
      abortControllerRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isAutoScroll && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, isAutoScroll]);

  const startStreaming = async (opts: StartStreamingOpts) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    const { attach = false, payload } = opts;

    try {
      const response = await fetch(attach ? '/api/pipeline?stream=1' : '/api/pipeline', {
        method: attach ? 'GET' : 'POST',
        headers: attach ? {} : { 'Content-Type': 'application/json' },
        body: attach ? null : JSON.stringify(payload ?? {}),
        signal: abortControllerRef.current.signal,
      });

      if (response.status === 409) {
        const data = await response.json();
        setStatus('running');
        alert(`Pipeline already running — query: ${data.query}, started at ${new Date(data.startedAt).toLocaleTimeString()}`);
        return;
      }

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to start run');
      }

      setStatus('running');
      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let exitCode = 0;
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let sep = buffer.indexOf('\n\n');
        while (sep >= 0) {
          const part = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          sep = buffer.indexOf('\n\n');

          if (part.startsWith('data: ')) {
            const data = part.slice(6);
            setLogs(prev => [...prev, data]);
            if (data.includes('DailyQuotaExceededError') || data.includes('daily quota exhausted')) {
              setStatus('quota-exceeded');
            }
          } else if (part.includes('event: done')) {
            const dataMatch = part.match(/data: (\d+)/);
            if (dataMatch) {
              exitCode = parseInt(dataMatch[1], 10);
            }
          } else if (part.includes('event: error')) {
             setStatus('failed');
          }
        }
      }

      setStatus(prev => {
        if (prev === 'quota-exceeded' || prev === 'cancelled' || prev === 'failed') return prev;
        return exitCode === 0 ? 'done (exit 0)' : `failed (exit ${exitCode})`;
      });
      refetchResumable();
    } catch (err: any) {
      if (err.name === 'AbortError') {
        // Only set cancelled if we didn't just start a new one
      } else {
        console.error('Streaming error:', err);
        setStatus('failed');
      }
    }
  };

  const handleRun = () => {
    if (!query.trim()) return;
    setLogs([]);
    startStreaming({ payload: { query } });
  };

  const handleResume = () => {
    setLogs([]);
    startStreaming({ payload: { resumeOnly: true } });
  };

  const handleCancel = async () => {
    try {
      setStatus('cancelled');
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      await fetch('/api/pipeline', { method: 'DELETE' });
    } catch (err) {
      console.error('Failed to cancel run:', err);
    }
  };

  const handleClearLog = () => {
    setLogs([]);
  };

  const handleScroll = () => {
    if (!logContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = logContainerRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 50;
    setIsAutoScroll(atBottom);
  };

  const getBadgeVariant = () => {
    if (status === 'running') return 'default';
    if (status === 'done (exit 0)') return 'secondary';
    if (status.includes('failed') || status === 'quota-exceeded') return 'destructive';
    return 'outline';
  };

  const showResumeBanner =
    resumableCount !== null && resumableCount > 0 && status !== 'running';

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {showResumeBanner && (
        <Card className="bg-amber-50 border-amber-300">
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 mt-0.5 text-amber-700" />
              <div>
                <p className="text-sm font-medium text-amber-900">
                  {resumableCount} repo{resumableCount === 1 ? '' : 's'} from a previous run still need processing.
                </p>
                <p className="text-xs text-amber-800/80">
                  Resume picks up where the last run left off — no new GitHub search.
                </p>
              </div>
            </div>
            <Button onClick={handleResume} className="bg-amber-600 hover:bg-amber-700 text-white">
              <RotateCw className="mr-2 h-4 w-4" />
              Resume {resumableCount} repo{resumableCount === 1 ? '' : 's'}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-2xl font-bold">Run Pipeline</CardTitle>
          <Badge variant={getBadgeVariant()} className="capitalize">
            {status}
          </Badge>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4">
            <Input
              placeholder="Enter discovery query (e.g. 'agent skills')"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={status === 'running'}
              className="flex-1"
            />
            {status === 'running' ? (
              <Button variant="destructive" onClick={handleCancel}>
                <XCircle className="mr-2 h-4 w-4" /> Cancel
              </Button>
            ) : (
              <Button onClick={handleRun} disabled={!query.trim()}>
                <Play className="mr-2 h-4 w-4" /> Run
              </Button>
            )}
            <Button variant="outline" onClick={handleClearLog} disabled={status === 'running' || logs.length === 0}>
              <Trash2 className="mr-2 h-4 w-4" /> Clear
            </Button>
          </div>

          {status === 'quota-exceeded' && (
            <div className="mt-4 p-4 bg-destructive/10 border border-destructive text-destructive rounded-md flex items-start gap-3">
              <AlertCircle className="h-5 w-5 mt-0.5" />
              <div>
                <p className="font-bold">Daily Quota Exceeded</p>
                <p className="text-sm">LLM daily quota hit — try again after UTC midnight.</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-black text-white">
        <CardContent className="p-0">
          <pre
            ref={logContainerRef}
            onScroll={handleScroll}
            className="p-4 font-mono text-sm overflow-y-auto max-h-[60vh] whitespace-pre-wrap break-words"
          >
            {logs.length === 0 ? (
              <span className="text-gray-500 italic">No logs to show...</span>
            ) : (
              logs.map((log, i) => (
                <div key={i} className={log.includes('[ERROR]') ? 'text-red-400' : log.includes('[WARN]') ? 'text-yellow-400' : ''}>
                  {log}
                </div>
              ))
            )}
            <div ref={logEndRef} />
          </pre>
        </CardContent>
      </Card>

      {status === 'running' && (
        <div className="flex justify-center text-sm text-gray-500 animate-pulse">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Pipeline is running...
        </div>
      )}
    </div>
  );
}
