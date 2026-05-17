// app/api/settings/llm-provider/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

const ALLOWED = new Set(['groq', 'gemini', 'claude-cli', 'codex-cli'])

export async function GET() {
  const { data, error } = await supabaseServer
    .from('settings')
    .select('value')
    .eq('key', 'llm_provider')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ current: data?.value ?? 'groq' })
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const value = body?.value
  if (typeof value !== 'string' || !ALLOWED.has(value)) {
    return NextResponse.json(
      { error: `value must be one of ${[...ALLOWED].join(', ')}` },
      { status: 400 }
    )
  }

  const { error } = await supabaseServer
    .from('settings')
    .upsert({ key: 'llm_provider', value }, { onConflict: 'key' })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ current: value })
}
