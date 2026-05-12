'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function StatsPage() {
  const [stats, setStats] = useState<any>({
    classes: [],
    tags: [],
    activities: [],
    domains: []
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchStats() {
      const { data: analyses } = await supabase.from('analysis_with_axes').select('*')

      if (!analyses) return

      const aggregate = (arr: any[], key: string) => {
        const counts: Record<string, number> = {}
        arr.forEach(item => {
          const values = Array.isArray(item[key]) ? item[key] : [item[key]]
          values.forEach((v: string) => {
            if (v) counts[v] = (counts[v] || 0) + 1
          })
        })
        return Object.entries(counts)
          .map(([name, n]) => ({ name, n }))
          .sort((a, b) => (b.n as number) - (a.n as number))
          .slice(0, 10)
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

  const StatSection = ({ title, data }: { title: string, data: any[] }) => (
    <Card className="bg-white">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {data.map((item, idx) => (
            <li key={idx} className="flex justify-between items-center text-sm">
              <span>{item.name}</span>
              <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded">{item.n}</span>
            </li>
          ))}
          {data.length === 0 && <li className="text-muted-foreground italic">No data yet</li>}
        </ul>
      </CardContent>
    </Card>
  )

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold">Statistics</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <StatSection title="Top Classes" data={stats.classes} />
        <StatSection title="Top Domains" data={stats.domains} />
        <StatSection title="Top Activities" data={stats.activities} />
        <StatSection title="Top Tags" data={stats.tags} />
      </div>
    </div>
  )
}
