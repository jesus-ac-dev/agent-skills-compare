'use client'

import { Suspense, useEffect, useState, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import Link from 'next/link'

type AxisFilter = { key: 'class' | 'domain' | 'activity' | 'tag'; value: string }

function readAxisFilter(params: URLSearchParams): AxisFilter | null {
  for (const key of ['class', 'domain', 'activity', 'tag'] as const) {
    const value = params.get(key)
    if (value) return { key, value }
  }
  return null
}

const PAGE_SIZE = 50

function AnalysesPageInner() {
  const params = useSearchParams()
  const axis = useMemo(
    () => readAxisFilter(new URLSearchParams(params.toString())),
    [params]
  )
  const [analyses, setAnalyses] = useState<any[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)

  // Reset to first page when filter changes.
  useEffect(() => {
    setPage(0)
  }, [axis])

  useEffect(() => {
    async function fetchAnalyses() {
      setLoading(true)
      const applyAxis = (q: any) => {
        if (!axis) return q
        if (axis.key === 'class') return q.eq('class', axis.value)
        return q.contains(`${axis.key}s`, [axis.value])
      }

      const from = page * PAGE_SIZE
      const to = from + PAGE_SIZE - 1

      const [rowsRes, countRes] = await Promise.all([
        applyAxis(supabase.from('analysis_with_axes').select('*').range(from, to)),
        applyAxis(
          supabase.from('analysis_with_axes').select('*', { count: 'exact', head: true })
        )
      ])

      if (rowsRes.error) {
        console.error('Error fetching analyses:', rowsRes.error)
      } else {
        setAnalyses(rowsRes.data ?? [])
      }
      if (typeof countRes.count === 'number') setTotal(countRes.count)
      setLoading(false)
    }

    fetchAnalyses()
  }, [axis, page])

  const filteredAnalyses = useMemo(() => {
    return analyses.filter(a => {
      const searchLower = search.toLowerCase()
      return (
        a.repo_name?.toLowerCase().includes(searchLower) ||
        a.summary?.toLowerCase().includes(searchLower) ||
        a.class?.toLowerCase().includes(searchLower) ||
        a.domains?.some((d: string) => d.toLowerCase().includes(searchLower)) ||
        a.activities?.some((act: string) => act.toLowerCase().includes(searchLower)) ||
        a.tags?.some((t: string) => t.toLowerCase().includes(searchLower))
      )
    })
  }, [analyses, search])

  if (loading) return <div>Loading...</div>

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4">
        <h1 className="text-3xl font-bold">Analyses</h1>
        {axis && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Filtered by</span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-200">
              {axis.key}: {axis.value}
              <Link href="/" className="ml-1 hover:underline" title="Clear filter">
                ×
              </Link>
            </span>
            <span className="text-muted-foreground">({analyses.length} match{analyses.length === 1 ? '' : 'es'})</span>
          </div>
        )}
        <Input
          placeholder="Search by repo, class, domain, activity or tag..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md"
        />
      </div>

      <div className="border rounded-md bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Repo</TableHead>
              <TableHead>Class</TableHead>
              <TableHead>Domains</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Summary</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredAnalyses.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="font-medium">
                  <div className="flex flex-col">
                    <Link href={`/repos/${a.repo_id}`} className="hover:underline text-blue-600">
                      {a.repo_name}
                    </Link>
                    <span className="text-xs text-muted-foreground truncate max-w-[200px]">{a.file_path}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{a.class}</Badge>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {a.domains?.map((d: string) => (
                      <Badge key={d} variant="secondary" className="text-[10px]">{d}</Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell>{a.score?.toFixed(1)}</TableCell>
                <TableCell className="max-w-xs truncate">{a.summary}</TableCell>
              </TableRow>
            ))}
            {filteredAnalyses.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  No analyses found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {total !== null && total > PAGE_SIZE && !search && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {page + 1} of {Math.max(1, Math.ceil(total / PAGE_SIZE))} ·{' '}
            {total} total
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="px-3 py-1 rounded border bg-white hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              ← Prev
            </button>
            <button
              type="button"
              disabled={(page + 1) * PAGE_SIZE >= total}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1 rounded border bg-white hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next →
            </button>
          </div>
        </div>
      )}
      {search && (
        <p className="text-xs text-muted-foreground">
          Text search filters the current page only — clear it to paginate the full result set.
        </p>
      )}
    </div>
  )
}

export default function AnalysesPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <AnalysesPageInner />
    </Suspense>
  )
}
