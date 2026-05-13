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

  // Filter on the Analyzed Files section. Defaults to 'completed' so the
  // useful classifications show up first; 'all' shows everything.
  const [fileStatusFilter, setFileStatusFilter] = useState<string>('completed')
  const visibleFiles = useMemo(() => {
    if (fileStatusFilter === 'all') return files
    return files.filter((f) => (f.status || 'pending') === fileStatusFilter)
  }, [files, fileStatusFilter])

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

  async function handleRunThisRepo() {
    setRunState('starting')
    setRunError(null)
    try {
      const res = await fetch('/api/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoId: Number(id) })
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
      // Drain the SSE stream just to keep the connection alive — we don't
      // render logs here, we rely on the polling effect below to detect end.
      const reader = res.body?.getReader()
      if (reader) {
        ;(async () => {
          while (true) {
            const { done } = await reader.read()
            if (done) break
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
          <div className="flex gap-2">
            {repo.status !== 'pending' && repo.status !== 'processing' && (
              <Button
                onClick={handleReanalyze}
                disabled={updating || runState === 'running' || runState === 'starting'}
                variant="outline"
              >
                {updating ? 'Queuing…' : 'Re-analyze'}
              </Button>
            )}
            <Button
              onClick={handleRunThisRepo}
              disabled={runState === 'starting' || runState === 'running' || runState === 'busy-other'}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {runState === 'running'
                ? '⏳ Running…'
                : runState === 'starting'
                  ? 'Starting…'
                  : '▶ Run this repo'}
            </Button>
          </div>
          {runError && <span className="text-xs text-red-700 max-w-xs text-right">{runError}</span>}
          {runState === 'idle' && (repo.status === 'pending' || repo.status === 'processing') && (
            <span className="text-xs text-muted-foreground">
              Queued ({repo.status}) — click Run to process it now
            </span>
          )}
        </div>
      </div>

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
              onClick={() => setFileStatusFilter('all')}
              className={`px-2 py-1 rounded border ${
                fileStatusFilter === 'all'
                  ? 'bg-neutral-900 text-white border-neutral-900'
                  : 'bg-white hover:bg-neutral-50'
              }`}
            >
              all ({files.length})
            </button>
            {STATUS_ORDER.filter((s) => statusCounts[s]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setFileStatusFilter(s)}
                className={`px-2 py-1 rounded border ${
                  fileStatusFilter === s
                    ? STATUS_COLOURS[s] + ' ring-2 ring-offset-1 ring-neutral-400'
                    : STATUS_COLOURS[s] + ' opacity-70 hover:opacity-100'
                }`}
              >
                {s} ({statusCounts[s]})
              </button>
            ))}
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
