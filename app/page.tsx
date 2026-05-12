'use client'

import { useEffect, useState, useMemo } from 'react'
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

export default function AnalysesPage() {
  const [analyses, setAnalyses] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    async function fetchAnalyses() {
      const { data, error } = await supabase
        .from('analysis_with_axes')
        .select('*')

      if (error) {
        console.error('Error fetching analyses:', {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint,
        })
      } else {
        setAnalyses(data || [])
      }
      setLoading(false)
    }

    fetchAnalyses()
  }, [])

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
