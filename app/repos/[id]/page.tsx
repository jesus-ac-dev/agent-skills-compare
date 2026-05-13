'use client'

import { useEffect, useState, useMemo, use } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

const STATUS_ORDER = ['completed', 'reused', 'skipped', 'pending', 'processing', 'error'] as const
const STATUS_COLOURS: Record<string, string> = {
  completed: 'bg-green-100 text-green-800 border-green-200',
  reused: 'bg-blue-100 text-blue-800 border-blue-200',
  skipped: 'bg-neutral-100 text-neutral-700 border-neutral-200',
  pending: 'bg-amber-100 text-amber-800 border-amber-200',
  processing: 'bg-amber-100 text-amber-800 border-amber-200',
  error: 'bg-red-100 text-red-800 border-red-200'
}

function relativeTime(iso: string | null | undefined) {
  if (!iso) return 'never'
  const then = new Date(iso).getTime()
  const diff = Date.now() - then
  if (diff < 0) return 'in the future'
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} h ago`
  const days = Math.floor(hr / 24)
  if (days < 30) return `${days} d ago`
  const months = Math.floor(days / 30)
  return `${months} mo ago`
}

export default function RepoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [repo, setRepo] = useState<any>(null)
  const [files, setFiles] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)

  useEffect(() => {
    async function fetchData() {
      const { data: repoData } = await supabase
        .from('repos')
        .select('*')
        .eq('id', id)
        .single()

      // PostgREST caps a single SELECT at 1000 rows; for big repos
      // (alirezarezvani/claude-skills has ~2800 files) the tail would
      // silently vanish. Page through until we get a short page.
      const pageSize = 1000
      const accumulated: any[] = []
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
          .from('files_sources')
          .select(
            `*, analysis(
              *,
              classes(name),
              analysis_domains(domains(name)),
              analysis_activities(activities(name)),
              analysis_tags(tags(name))
            )`
          )
          .eq('repo_id', id)
          .range(from, from + pageSize - 1)
        if (error || !data || data.length === 0) break
        accumulated.push(...data)
        if (data.length < pageSize) break
      }

      setRepo(repoData)
      setFiles(accumulated)
      setLoading(false)
    }

    if (id) fetchData()
  }, [id])

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const f of files) {
      const s = f.status || 'pending'
      counts[s] = (counts[s] || 0) + 1
    }
    return counts
  }, [files])

  // Filter on the Analyzed Files section. 'analyzed' is a virtual filter
  // that combines completed + reused (files that have an analysis, either
  // freshly classified or hash-matched). Defaults to 'analyzed' so the
  // useful classifications show up by default regardless of whether they
  // were just classified or kept from a previous run.
  const [fileStatusFilter, setFileStatusFilter] = useState<string>('analyzed')
  const visibleFiles = useMemo(() => {
    if (fileStatusFilter === 'all') return files
    if (fileStatusFilter === 'analyzed') {
      return files.filter((f) => f.status === 'completed' || f.status === 'reused')
    }
    return files.filter((f) => (f.status || 'pending') === fileStatusFilter)
  }, [files, fileStatusFilter])

  const analyzedCount =
    (statusCounts['completed'] ?? 0) + (statusCounts['reused'] ?? 0)

  // Reanalyze (mark pending without running) — currently unused in the UI;
  // /repos listing still calls the same Supabase pattern inline. Kept here
  // in case we want to bring back a "queue for later" button.
  async function handleReanalyze() {
    setUpdating(true)
    const { error } = await supabase
      .from('repos')
      .update({ status: 'pending', error_count: 0, last_error: null })
      .eq('id', id)

    if (error) {
      alert('Failed to update status: ' + error.message)
    } else {
      setRepo({ ...repo, status: 'pending', error_count: 0, last_error: null })
    }
    setUpdating(false)
  }

  // Single-repo pipeline run: POSTs /api/pipeline with { repoId } and polls
  // for completion. Re-fetches the repo + files when done so the UI reflects
  // fresh analyses.
  const [runState, setRunState] = useState<'idle' | 'starting' | 'running' | 'busy-other'>('idle')
  const [runError, setRunError] = useState<string | null>(null)
  const [runLogs, setRunLogs] = useState<string[]>([])
  const [logsCollapsed, setLogsCollapsed] = useState(false)

  async function refreshRepoData() {
    const { data: repoData } = await supabase.from('repos').select('*').eq('id', id).single()
    if (repoData) setRepo(repoData)
    // re-trigger files fetch via the existing effect by toggling loading
    // would be cleaner with a refetch function; keep simple — do it inline:
    const pageSize = 1000
    const accumulated: any[] = []
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase
        .from('files_sources')
        .select(
          `*, analysis(
            *,
            classes(name),
            analysis_domains(domains(name)),
            analysis_activities(activities(name)),
            analysis_tags(tags(name))
          )`
        )
        .eq('repo_id', id)
        .range(from, from + pageSize - 1)
      if (error || !data || data.length === 0) break
      accumulated.push(...data)
      if (data.length < pageSize) break
    }
    setFiles(accumulated)
  }

  async function handleRunThisRepo(force = false) {
    setRunState('starting')
    setRunError(null)
    setRunLogs([])
    setLogsCollapsed(false)
    try {
      const res = await fetch('/api/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoId: Number(id), force })
      })
      if (res.status === 409) {
        const data = await res.json().catch(() => ({}))
        setRunState('busy-other')
        setRunError(
          `Pipeline is already running another job (${data.query ?? '?'}). Wait or cancel it in /run.`
        )
        return
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      setRunState('running')
      // Consume the SSE stream and surface log lines so the user can see what
      // the pipeline is doing without having to leave the page.
      const reader = res.body?.getReader()
      if (reader) {
        ;(async () => {
          const decoder = new TextDecoder()
          let buffer = ''
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            let sep = buffer.indexOf('\n\n')
            while (sep >= 0) {
              const chunk = buffer.slice(0, sep)
              buffer = buffer.slice(sep + 2)
              sep = buffer.indexOf('\n\n')
              if (chunk.startsWith('data: ')) {
                const line = chunk.slice(6)
                setRunLogs((prev) => [...prev, line])
              } else if (chunk.startsWith('event: done')) {
                setRunLogs((prev) => [...prev, '── pipeline finished ──'])
              } else if (chunk.startsWith('event: error')) {
                setRunLogs((prev) => [...prev, '── pipeline error ──'])
              }
            }
          }
        })()
      }
    } catch (err) {
      setRunState('idle')
      setRunError(err instanceof Error ? err.message : String(err))
    }
  }

  // Poll /api/pipeline while a run is happening on THIS repo. When it ends,
  // refresh the page data so the new analyses + status are visible.
  useEffect(() => {
    if (runState !== 'running') return
    let stopped = false
    const tick = async () => {
      try {
        const res = await fetch('/api/pipeline')
        const data = await res.json()
        if (stopped) return
        if (!data.running) {
          setRunState('idle')
          await refreshRepoData()
        } else if (data.repoId !== Number(id)) {
          setRunState('busy-other')
          setRunError(`Pipeline switched to another job (${data.query ?? '?'}).`)
        }
      } catch {
        // ignore one-off network errors
      }
    }
    const handle = setInterval(tick, 3000)
    return () => {
      stopped = true
      clearInterval(handle)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runState, id])

  if (loading) return <div>Loading...</div>
  if (!repo) return <div>Repo not found</div>

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-start gap-4">
        <div className="flex items-start gap-4 min-w-0">
          {repo.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={repo.avatar_url}
              alt=""
              className="w-16 h-16 rounded-full bg-neutral-200 shrink-0"
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-neutral-200 shrink-0" />
          )}
          <div className="min-w-0">
            <h1 className="text-4xl font-bold truncate">{repo.name}</h1>
            <a
              href={repo.repo_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-neutral-700 hover:underline text-sm"
            >
              {repo.repo_url} ↗
            </a>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
              <Badge>{repo.status}</Badge>
              <span>Stars: {repo.stars}</span>
              <span className="text-muted-foreground">
                Analyzed: {relativeTime(repo.last_processed_at)}
              </span>
              {repo.error_count > 0 && (
                <span className="text-red-700">errors: {repo.error_count}</span>
              )}
            </div>
          </div>
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1">
          {(() => {
            const pendingCount = statusCounts['pending'] ?? 0
            const isForceMode = pendingCount === 0 && analyzedCount > 0
            const busy =
              runState === 'starting' || runState === 'running' || runState === 'busy-other'
            const label =
              runState === 'running'
                ? '⏳ Running…'
                : runState === 'starting'
                  ? 'Starting…'
                  : isForceMode
                    ? `↻ Force re-analyze (${analyzedCount})`
                    : `▶ Process ${pendingCount} pending`
            return (
              <Button
                onClick={() => handleRunThisRepo(isForceMode)}
                disabled={busy || (pendingCount === 0 && analyzedCount === 0)}
                className={
                  isForceMode
                    ? 'bg-blue-600 hover:bg-blue-700 text-white'
                    : 'bg-amber-600 hover:bg-amber-700 text-white'
                }
                title={
                  isForceMode
                    ? 'Re-classify every analyzed file (ignores hash cache)'
                    : `Process the ${pendingCount} pending file(s) — analyzed files are kept`
                }
              >
                {label}
              </Button>
            )
          })()}
          {runError && <span className="text-xs text-red-700 max-w-xs text-right">{runError}</span>}
          {runState === 'idle' && (repo.status === 'pending' || repo.status === 'processing') && (
            <span className="text-xs text-muted-foreground">
              Repo flagged as {repo.status} — will be picked up by the next /run too
            </span>
          )}
        </div>
      </div>

      {(runState === 'running' || runLogs.length > 0) && (
        <div className="border rounded-md bg-neutral-50">
          <div className="flex items-center justify-between px-3 py-2 border-b text-sm">
            <span className="font-medium">
              Pipeline log{' '}
              <span className="text-muted-foreground font-normal">
                ({runLogs.length} line{runLogs.length === 1 ? '' : 's'})
              </span>
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setLogsCollapsed((v) => !v)}
                className="text-xs px-2 py-0.5 rounded border bg-white hover:bg-neutral-100"
              >
                {logsCollapsed ? 'Show' : 'Hide'}
              </button>
              {runState !== 'running' && (
                <button
                  type="button"
                  onClick={() => setRunLogs([])}
                  className="text-xs px-2 py-0.5 rounded border bg-white hover:bg-neutral-100"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          {!logsCollapsed && (
            <pre className="p-3 text-xs font-mono whitespace-pre-wrap max-h-72 overflow-auto">
              {runLogs.length === 0
                ? '(waiting for output…)'
                : runLogs.join('\n')}
            </pre>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2 text-xs">
        <span className="text-muted-foreground self-center mr-1">Files:</span>
        {STATUS_ORDER.filter((s) => statusCounts[s]).map((s) => (
          <span
            key={s}
            className={`px-2 py-0.5 rounded border ${STATUS_COLOURS[s]}`}
            title={`${statusCounts[s]} ${s} file(s)`}
          >
            {statusCounts[s]} {s}
          </span>
        ))}
        {Object.keys(statusCounts).length === 0 && (
          <span className="text-muted-foreground italic">no files yet</span>
        )}
      </div>

      <div className="grid gap-6">
        <div className="flex justify-between items-center flex-wrap gap-3">
          <h2 className="text-2xl font-semibold">Analyzed Files</h2>
          <div className="flex flex-wrap gap-1 text-xs">
            <button
              type="button"
              onClick={() => setFileStatusFilter('analyzed')}
              className={`px-2 py-1 rounded border ${
                fileStatusFilter === 'analyzed'
                  ? 'bg-green-100 text-green-800 border-green-200 ring-2 ring-offset-1 ring-neutral-400'
                  : 'bg-green-100 text-green-800 border-green-200 opacity-70 hover:opacity-100'
              }`}
              title="Files that have an analysis (completed or reused)"
            >
              analyzed ({analyzedCount})
            </button>
            <button
              type="button"
              onClick={() => setFileStatusFilter('pending')}
              className={`px-2 py-1 rounded border ${
                fileStatusFilter === 'pending'
                  ? STATUS_COLOURS.pending + ' ring-2 ring-offset-1 ring-neutral-400'
                  : STATUS_COLOURS.pending + ' opacity-70 hover:opacity-100'
              }`}
            >
              pending ({statusCounts['pending'] ?? 0})
            </button>
            {(statusCounts['error'] ?? 0) > 0 && (
              <button
                type="button"
                onClick={() => setFileStatusFilter('error')}
                className={`px-2 py-1 rounded border ${
                  fileStatusFilter === 'error'
                    ? STATUS_COLOURS.error + ' ring-2 ring-offset-1 ring-neutral-400'
                    : STATUS_COLOURS.error + ' opacity-70 hover:opacity-100'
                }`}
              >
                error ({statusCounts['error']})
              </button>
            )}
          </div>
        </div>
        {visibleFiles.length === 0 && (
          <p className="text-muted-foreground italic">
            No files with status &ldquo;{fileStatusFilter}&rdquo;.
          </p>
        )}
        {visibleFiles.map((f) => (
          <Card key={f.id}>
            <CardHeader>
              <div className="flex justify-between items-start gap-2">
                <CardTitle className="text-lg truncate max-w-[70%]">{f.path}</CardTitle>
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded border ${
                      STATUS_COLOURS[f.status || 'pending']
                    }`}
                  >
                    {f.status || 'pending'}
                  </span>
                  {f.analysis?.classes?.name && (
                    <Link
                      href={`/?class=${encodeURIComponent(f.analysis.classes.name)}`}
                      title="Filter by this class"
                    >
                      <Badge
                        variant="outline"
                        className="cursor-pointer hover:bg-neutral-100"
                      >
                        {f.analysis.classes.name}
                      </Badge>
                    </Link>
                  )}
                </div>
              </div>
              <CardDescription className="truncate">
                <a
                  href={f.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-neutral-700 hover:underline"
                >
                  {f.url} ↗
                </a>
              </CardDescription>
              {f.analysis && (
                <div className="flex flex-wrap gap-1 pt-2">
                  {(f.analysis.analysis_domains ?? []).map(
                    (d: { domains: { name: string } }) =>
                      d.domains?.name && (
                        <Link
                          key={`d-${d.domains.name}`}
                          href={`/?domain=${encodeURIComponent(d.domains.name)}`}
                          title="Filter by this domain"
                        >
                          <Badge
                            variant="secondary"
                            className="text-[10px] cursor-pointer hover:bg-neutral-200"
                          >
                            {d.domains.name}
                          </Badge>
                        </Link>
                      )
                  )}
                  {(f.analysis.analysis_activities ?? []).map(
                    (a: { activities: { name: string } }) =>
                      a.activities?.name && (
                        <Link
                          key={`a-${a.activities.name}`}
                          href={`/?activity=${encodeURIComponent(a.activities.name)}`}
                          title="Filter by this activity"
                        >
                          <Badge
                            variant="outline"
                            className="text-[10px] cursor-pointer hover:bg-neutral-100"
                          >
                            {a.activities.name}
                          </Badge>
                        </Link>
                      )
                  )}
                  {(f.analysis.analysis_tags ?? []).map(
                    (t: { tags: { name: string } }) =>
                      t.tags?.name && (
                        <Link
                          key={`t-${t.tags.name}`}
                          href={`/?tag=${encodeURIComponent(t.tags.name)}`}
                          title="Filter by this tag"
                        >
                          <Badge
                            variant="outline"
                            className="text-[10px] cursor-pointer hover:bg-blue-50 border-blue-200"
                          >
                            #{t.tags.name}
                          </Badge>
                        </Link>
                      )
                  )}
                </div>
              )}
            </CardHeader>
            <CardContent>
              {f.analysis ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    {typeof f.analysis.score === 'number' && (
                      <span title="Score 0–10">★ {f.analysis.score.toFixed(1)}</span>
                    )}
                    {f.analysis.maturity && (
                      <span
                        className={
                          f.analysis.maturity === 'stable'
                            ? 'text-green-700'
                            : f.analysis.maturity === 'abandoned'
                              ? 'text-red-700'
                              : 'text-amber-700'
                        }
                      >
                        {f.analysis.maturity}
                      </span>
                    )}
                    {f.analysis.model && (
                      <span title="LLM that produced this analysis">via {f.analysis.model}</span>
                    )}
                  </div>
                  <p>{f.analysis.summary}</p>
                  {f.analysis.use_cases?.length > 0 && (
                    <div>
                      <h4 className="font-medium mb-2">Use Cases</h4>
                      <ul className="list-disc pl-5 space-y-1">
                        {f.analysis.use_cases.map((uc: any, idx: number) => (
                          <li key={idx}>
                            <span className="font-semibold">{uc.title}:</span> {uc.description}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-muted-foreground italic">
                  No analysis available for this file.
                  {f.status === 'error' && f.last_checked && (
                    <span className="block mt-1 text-xs text-red-700">
                      Last attempt failed. Reanalyze to retry.
                    </span>
                  )}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
