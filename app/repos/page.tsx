'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type Repo = {
  id: number
  name: string
  repo_url: string
  avatar_url: string | null
  status: string
  stars: number | null
  error_count: number | null
  last_processed_at: string | null
  last_error: string | null
  files_sources: Array<{ count: number }> | { count: number }[]
}

const STATUS_BADGE: Record<string, string> = {
  done: 'bg-green-100 text-green-800 border-green-200',
  processing: 'bg-amber-100 text-amber-800 border-amber-200',
  pending: 'bg-blue-100 text-blue-800 border-blue-200',
  failed: 'bg-red-100 text-red-800 border-red-200'
}

function relativeTime(iso: string | null) {
  if (!iso) return 'never'
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 0) return 'soon'
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const days = Math.floor(hr / 24)
  if (days < 30) return `${days}d ago`
  return `${Math.floor(days / 30)}mo ago`
}

export default function ReposListPage() {
  const [repos, setRepos] = useState<Repo[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [onlyWithErrors, setOnlyWithErrors] = useState(false)
  const [updatingId, setUpdatingId] = useState<number | null>(null)

  async function fetchRepos() {
    const { data, error } = await supabase
      .from('repos')
      .select('*, files_sources(count)')
      .order('last_processed_at', { ascending: false, nullsFirst: false })
    if (error) {
      console.error('Failed to fetch repos:', error)
    } else {
      setRepos((data ?? []) as Repo[])
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchRepos()
  }, [])

  const filtered = useMemo(() => {
    return repos.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (onlyWithErrors && (r.error_count ?? 0) === 0) return false
      if (search) {
        const s = search.toLowerCase()
        return r.name?.toLowerCase().includes(s) || r.repo_url?.toLowerCase().includes(s)
      }
      return true
    })
  }, [repos, search, statusFilter, onlyWithErrors])

  async function reanalyze(id: number) {
    setUpdatingId(id)
    const { error } = await supabase.from('repos').update({ status: 'pending' }).eq('id', id)
    if (error) {
      alert(`Failed: ${error.message}`)
    } else {
      setRepos((prev) => prev.map((r) => (r.id === id ? { ...r, status: 'pending' } : r)))
    }
    setUpdatingId(null)
  }

  if (loading) return <div>Loading repos…</div>

  const fileCount = (r: Repo) => {
    const fs = Array.isArray(r.files_sources) ? r.files_sources[0] : r.files_sources
    return fs?.count ?? 0
  }

  const statuses = ['all', 'done', 'processing', 'pending', 'failed']
  const totalErrors = repos.reduce((sum, r) => sum + (r.error_count ?? 0), 0)

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4">
        <h1 className="text-3xl font-bold">Repositories</h1>
        <p className="text-sm text-muted-foreground">
          {repos.length} repos · {totalErrors} total file errors across all repos.
        </p>
        <div className="flex flex-wrap gap-3 items-center">
          <Input
            placeholder="Search by name or URL…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
          <div className="flex gap-1">
            {statuses.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={`text-xs px-2 py-1 rounded border ${
                  statusFilter === s
                    ? 'bg-neutral-900 text-white border-neutral-900'
                    : 'bg-white hover:bg-neutral-50'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              checked={onlyWithErrors}
              onChange={(e) => setOnlyWithErrors(e.target.checked)}
            />
            only with errors
          </label>
          <span className="text-xs text-muted-foreground ml-auto">
            Showing {filtered.length} of {repos.length}
          </span>
        </div>
      </div>

      <div className="border rounded-md bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Repo</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Files</TableHead>
              <TableHead>Errors</TableHead>
              <TableHead>Last analyzed</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">
                    {r.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={r.avatar_url}
                        alt=""
                        className="w-6 h-6 rounded-full bg-neutral-200 shrink-0"
                      />
                    ) : (
                      <div className="w-6 h-6 rounded-full bg-neutral-200 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <Link href={`/repos/${r.id}`} className="text-blue-600 hover:underline">
                        {r.name}
                      </Link>
                      <div className="text-xs text-muted-foreground truncate max-w-[280px]">
                        {r.repo_url}
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <span
                    className={`text-xs px-2 py-0.5 rounded border ${
                      STATUS_BADGE[r.status] ?? 'bg-neutral-100 border-neutral-200'
                    }`}
                  >
                    {r.status}
                  </span>
                </TableCell>
                <TableCell>{fileCount(r)}</TableCell>
                <TableCell>
                  {(r.error_count ?? 0) > 0 ? (
                    <span
                      className="text-red-700"
                      title={r.last_error?.slice(0, 200) ?? ''}
                    >
                      {r.error_count}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </TableCell>
                <TableCell className="text-xs">{relativeTime(r.last_processed_at)}</TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={updatingId === r.id || r.status === 'pending'}
                    onClick={() => reanalyze(r.id)}
                  >
                    {updatingId === r.id
                      ? '…'
                      : r.status === 'pending'
                        ? 'Queued'
                        : 'Reanalyze'}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  No repos match these filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
