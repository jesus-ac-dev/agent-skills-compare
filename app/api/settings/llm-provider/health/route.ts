import { NextResponse } from 'next/server'
import { GroqProvider } from '@/src/analysis/providers/groqProvider.js'
import { GeminiProvider } from '@/src/analysis/providers/geminiProvider.js'
import { ClaudeCliProvider } from '@/src/analysis/providers/claudeCliProvider.js'

export async function GET() {
  const providers = [new GroqProvider(), new GeminiProvider(), new ClaudeCliProvider()]

  const results = await Promise.all(
    providers.map(async (p) => {
      try {
        const r = await p.healthCheck()
        return [(p.constructor as typeof GroqProvider).providerName, r] as const
      } catch (err) {
        return [
          (p.constructor as typeof GroqProvider).providerName,
          { available: false, reason: err instanceof Error ? err.message : String(err) }
        ] as const
      }
    })
  )

  return NextResponse.json(Object.fromEntries(results))
}
