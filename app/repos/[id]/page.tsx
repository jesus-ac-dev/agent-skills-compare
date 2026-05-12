'use client'

import { useEffect, useState, use } from 'react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

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

      const { data: filesData } = await supabase
        .from('files_sources')
        .select('*, analysis(*, classes(name))')
        .eq('repo_id', id)

      setRepo(repoData)
      setFiles(filesData || [])
      setLoading(false)
    }

    if (id) fetchData()
  }, [id])

  async function handleReanalyze() {
    setUpdating(true)
    const { error } = await supabase
      .from('repos')
      .update({ status: 'pending' })
      .eq('id', id)

    if (error) {
      alert('Failed to update status: ' + error.message)
    } else {
      setRepo({ ...repo, status: 'pending' })
      alert('Repo status set to pending. The pipeline will pick it up on the next run.')
    }
    setUpdating(false)
  }

  if (loading) return <div>Loading...</div>
  if (!repo) return <div>Repo not found</div>

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-4xl font-bold">{repo.name}</h1>
          <p className="text-muted-foreground">{repo.repo_url}</p>
          <div className="mt-2 flex gap-2">
            <Badge>{repo.status}</Badge>
            <span className="text-sm">Stars: {repo.stars}</span>
          </div>
        </div>
        <Button onClick={handleReanalyze} disabled={updating || repo.status === 'pending'}>
          {repo.status === 'pending' ? 'Pending...' : 'Re-analyze Repo'}
        </Button>
      </div>

      <div className="grid gap-6">
        <h2 className="text-2xl font-semibold">Analyzed Files</h2>
        {files.map((f) => (
          <Card key={f.id}>
            <CardHeader>
              <div className="flex justify-between">
                <CardTitle className="text-lg truncate max-w-[80%]">{f.path}</CardTitle>
                {f.analysis?.classes?.name && (
                   <Badge variant="outline">{f.analysis.classes.name}</Badge>
                )}
              </div>
              <CardDescription className="truncate">{f.url}</CardDescription>
            </CardHeader>
            <CardContent>
              {f.analysis ? (
                <div className="space-y-4">
                  <p>{f.analysis.summary}</p>
                  <div>
                    <h4 className="font-medium mb-2">Use Cases</h4>
                    <ul className="list-disc pl-5 space-y-1">
                      {f.analysis.use_cases?.map((uc: any, idx: number) => (
                        <li key={idx}>
                          <span className="font-semibold">{uc.title}:</span> {uc.description}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground italic">No analysis available for this file.</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
