'use client';

import { useState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Play, XCircle, Trash2, Loader2, AlertCircle } from 'lucide-react';

type RunStatus = 'idle' | 'running' | 'done (exit 0)' | 'failed' | 'cancelled' | 'quota-exceeded' | string;

interface RunInfo {
  running: boolean;
  query?: string;
  startedAt?: string;
  runId?: string;
}

export default function RunPage() {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<RunStatus>('idle');
  const [logs, setLogs] = useState<string[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);
  const logContainerRef = useRef<HTMLPreElement>(null);
  const [isAutoScroll, setIsAutoScroll] = useState(true);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const checkStatus = async () => {
      try {
        const res = await fetch('/api/pipeline');
        const data: RunInfo = await res.json();
        if (data.running) {
          setStatus('running');
          setQuery(data.query || '');
          startStreaming(data.query || '', true);
        }
      } catch (err) {
        console.error('Failed to check status:', err);
      }
    };

    checkStatus();
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (isAutoScroll && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, isAutoScroll]);

  const startStreaming = async (runQuery: string, isResume = false) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch(isResume ? '/api/pipeline?stream=1' : '/api/pipeline', {
        method: isResume ? 'GET' : 'POST',
        headers: isResume ? {} : { 'Content-Type': 'application/json' },
        body: isResume ? null : JSON.stringify({ query: runQuery }),
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

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const parts = chunk.split('\n\n');

        for (const part of parts) {
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
    startStreaming(query);
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

  return (
    <div className="max-w-4xl mx-auto space-y-6">
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
            className="p-4 font-mono text-sm overflow-y-auto max-h-[60vh] whitespace-pre-wrap break-all"
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
