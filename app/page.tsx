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

function AnalysesPageInner() {
  const params = useSearchParams()
  const axis = useMemo(
    () => readAxisFilter(new URLSearchParams(params.toString())),
    [params]
  )
  const [analyses, setAnalyses] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    async function fetchAnalyses() {
      setLoading(true)
      let query = supabase.from('analysis_with_axes').select('*')
      if (axis) {
        if (axis.key === 'class') {
          query = query.eq('class', axis.value)
        } else {
          // domains/activities/tags are text[] in the view → use contains
          const column = `${axis.key}s` as const
          query = query.contains(column, [axis.value])
        }
      }
      const { data, error } = await query
      if (error) {
        console.error('Error fetching analyses:', error)
      } else {
        setAnalyses(data || [])
      }
      setLoading(false)
    }

    fetchAnalyses()
  }, [axis])

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
