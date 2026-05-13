// app/api/repos/route.ts
//
// POST /api/repos — manually queue a GitHub repo for the pipeline.
//   Body:  { url: "https://github.com/owner/repo" }
//   200:   { id, repo_url, name, status: "pending" }   newly inserted
//   200:   { id, repo_url, name, status: "<existing>", existed: true }   already in DB
//   400:   invalid URL shape
//   500:   DB error

import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { normaliseGithubUrl } from '@/src/utils/githubUrl.js'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const normalised = normaliseGithubUrl(body?.url)
  if (!normalised) {
    return NextResponse.json(
      {
        error:
          'url must look like "https://github.com/owner/repo" (no extra path segments)'
      },
      { status: 400 }
    )
  }

  const { data: existing } = await supabaseServer
    .from('repos')
    .select('id, repo_url, name, status')
    .eq('repo_url', normalised.repo_url)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ ...existing, existed: true })
  }

  const { data, error } = await supabaseServer
    .from('repos')
    .insert({
      repo_url: normalised.repo_url,
      name: normalised.name,
      status: 'pending'
    })
    .select('id, repo_url, name, status')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ...data, existed: false })
}
