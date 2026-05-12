'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

const POLL_INTERVAL_MS = 15_000

export function useResumable() {
  const [count, setCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  const refetch = useCallback(async () => {
    const { count: c, error } = await supabase
      .from('repos')
      .select('*', { count: 'exact', head: true })
      .in('status', ['processing', 'pending'])

    if (error) {
      console.error('useResumable error:', {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      })
      setCount(null)
    } else {
      setCount(c ?? 0)
    }
    setLoading(false)
  }, [])

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

  return { count, loading, refetch }
}
