'use client'

import Link from 'next/link'
import { useResumable } from '@/lib/use-resumable'

export function ResumableBadge() {
  const { count } = useResumable()

  const show = count !== null && count > 0

  return (
    <Link
      href="/run"
      className="text-sm font-medium hover:underline relative inline-flex items-center"
      aria-label={show ? `Run (${count} pending)` : 'Run'}
    >
      Run
      {show && (
        <span
          className="ml-2 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-amber-500 text-white text-xs font-semibold"
          title={`${count} repo${count === 1 ? '' : 's'} pending — click to resume`}
        >
          {count}
        </span>
      )}
    </Link>
  )
}
