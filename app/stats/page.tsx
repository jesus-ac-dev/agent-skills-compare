'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type Entry = { name: string; n: number }

const INITIAL_LIMIT = 10

export default function StatsPage() {
  const [stats, setStats] = useState<{
    classes: Entry[]
    tags: Entry[]
    activities: Entry[]
    domains: Entry[]
  }>({ classes: [], tags: [], activities: [], domains: [] })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchStats() {
      const { data: analyses } = await supabase.from('analysis_with_axes').select('*')

      if (!analyses) return

      const aggregate = (arr: any[], key: string): Entry[] => {
        const counts: Record<string, number> = {}
        arr.forEach((item) => {
          const values = Array.isArray(item[key]) ? item[key] : [item[key]]
          values.forEach((v: string) => {
            if (v) counts[v] = (counts[v] || 0) + 1
          })
        })
        return Object.entries(counts)
          .map(([name, n]) => ({ name, n }))
          .sort((a, b) => b.n - a.n)
      }

      setStats({
        classes: aggregate(analyses, 'class'),
        tags: aggregate(analyses, 'tags'),
        activities: aggregate(analyses, 'activities'),
        domains: aggregate(analyses, 'domains')
      })
      setLoading(false)
    }

    fetchStats()
  }, [])

  if (loading) return <div>Loading statistics...</div>

  const StatSection = ({
    title,
    data,
    paramKey
  }: {
    title: string
    data: Entry[]
    paramKey: 'class' | 'domain' | 'activity' | 'tag'
  }) => {
    const [showAll, setShowAll] = useState(false)
    const visible = showAll ? data : data.slice(0, INITIAL_LIMIT)
    const hidden = data.length - INITIAL_LIMIT

    return (
      <Card className="bg-white">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1">
            {visible.map((item) => (
              <li key={item.name}>
                <Link
                  href={`/?${paramKey}=${encodeURIComponent(item.name)}`}
                  className="flex justify-between items-center text-sm px-1 py-0.5 rounded hover:bg-neutral-50"
                >
                  <span className="hover:underline">{item.name}</span>
                  <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded">
                    {item.n}
                  </span>
                </Link>
              </li>
            ))}
            {data.length === 0 && <li className="text-muted-foreground italic">No data yet</li>}
          </ul>
          {hidden > 0 && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="mt-3 text-xs text-blue-600 hover:underline"
            >
              {showAll ? `Show top ${INITIAL_LIMIT}` : `Show all (${hidden} more)`}
            </button>
          )}
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold">Statistics</h1>
      <p className="text-sm text-muted-foreground">
        Click any entry to see the matching analyses.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <StatSection title="Classes" data={stats.classes} paramKey="class" />
        <StatSection title="Domains" data={stats.domains} paramKey="domain" />
        <StatSection title="Activities" data={stats.activities} paramKey="activity" />
        <StatSection title="Tags" data={stats.tags} paramKey="tag" />
      </div>
    </div>
  )
}
