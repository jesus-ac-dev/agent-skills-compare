'use client'

import { useEffect, useState, useCallback } from 'react'

const POLL_INTERVAL_MS = 30_000

export type ProviderName = 'groq' | 'gemini' | 'claude-cli'

export interface HealthMap {
  [name: string]: { available: boolean; reason?: string }
}

export function useProviderSettings() {
  const [current, setCurrent] = useState<ProviderName | null>(null)
  const [available, setAvailable] = useState<HealthMap>({})
  const [loading, setLoading] = useState(true)

  const refetch = useCallback(async () => {
    try {
      const [curRes, healthRes] = await Promise.all([
        fetch('/api/settings/llm-provider').then((r) => r.json()),
        fetch('/api/settings/llm-provider/health').then((r) => r.json())
      ])
      setCurrent(curRes.current as ProviderName)
      setAvailable(healthRes as HealthMap)
    } catch (err) {
      console.error('useProviderSettings fetch failed:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  const mutate = useCallback(
    async (name: ProviderName) => {
      const prev = current
      setCurrent(name) // optimistic
      try {
        const res = await fetch('/api/settings/llm-provider', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: name })
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.error || 'PUT failed')
        }
        const data = await res.json()
        setCurrent(data.current as ProviderName)
      } catch (err) {
        console.error('useProviderSettings mutate failed:', err)
        setCurrent(prev) // revert
        throw err
      }
    },
    [current]
  )

  useEffect(() => {
    refetch()
    const onFocus = () => refetch()
    window.addEventListener('focus', onFocus)
    const id = setInterval(refetch, POLL_INTERVAL_MS)
    return () => {
      window.removeEventListener('focus', onFocus)
      clearInterval(id)
    }
  }, [refetch])

  return { current, available, loading, mutate, refetch }
}
