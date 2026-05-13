'use client'

import { useEffect, useState } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useProviderSettings, type ProviderName } from '@/lib/use-provider-settings'

const LABELS: Record<ProviderName, string> = {
  groq: '⚡ Groq',
  gemini: '✨ Gemini',
  'claude-cli': '🤖 Claude CLI'
}

export function ProviderSelect() {
  const { current, available, loading, mutate } = useProviderSettings()
  const [running, setRunning] = useState(false)

  // Poll the pipeline state so we can disable the selector during runs.
  useEffect(() => {
    let stopped = false
    const tick = async () => {
      try {
        const res = await fetch('/api/pipeline')
        const data = await res.json()
        if (!stopped) setRunning(!!data.running)
      } catch {
        // ignore
      }
    }
    tick()
    const id = setInterval(tick, 5_000)
    return () => {
      stopped = true
      clearInterval(id)
    }
  }, [])

  if (loading || !current) {
    return <span className="text-sm text-muted-foreground">Provider: …</span>
  }

  const triggerClassName =
    'text-sm font-medium px-2 py-1 rounded border bg-white hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed'
  const triggerTitle = running
    ? 'Pipeline running — wait or cancel'
    : 'Switch active LLM (applies next run)'
  const triggerContent = (
    <>
      Provider: {LABELS[current]} {running ? '(locked)' : '▾'}
    </>
  )

  if (running) {
    return (
      <button
        type="button"
        disabled
        className={triggerClassName}
        title={triggerTitle}
      >
        {triggerContent}
      </button>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={triggerClassName}
        title={triggerTitle}
      >
        {triggerContent}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Switch LLM provider</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {(Object.keys(LABELS) as ProviderName[]).map((name) => {
          const isCurrent = name === current
          const isAvailable = available[name]?.available
          return (
            <DropdownMenuItem
              key={name}
              onClick={() => {
                void mutate(name)
              }}
              className="flex items-center justify-between gap-4"
            >
              <span>{LABELS[name]}</span>
              <span className="flex items-center gap-2 text-xs">
                {isCurrent && <span className="text-green-700">✓ active</span>}
                {!isCurrent && isAvailable && <span className="text-green-700">● ready</span>}
                {!isCurrent && !isAvailable && (
                  <span
                    className="text-neutral-500"
                    title={available[name]?.reason ?? 'not available'}
                  >
                    ● n/a
                  </span>
                )}
              </span>
            </DropdownMenuItem>
          )
        })}
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            Applies to next run
          </DropdownMenuLabel>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
