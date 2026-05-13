'use client'

import { useState } from 'react'

type Status = 'idle' | 'submitting' | 'ok' | 'existed' | 'error'

export function RepoAdd() {
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState<string>('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = url.trim()
    if (!trimmed) return

    setStatus('submitting')
    setMessage('')
    try {
      const res = await fetch('/api/repos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed })
      })
      const data = await res.json()
      if (!res.ok) {
        setStatus('error')
        setMessage(data?.error ?? `HTTP ${res.status}`)
        return
      }
      if (data.existed) {
        setStatus('existed')
        setMessage(`Already in DB as ${data.name} (status: ${data.status})`)
      } else {
        setStatus('ok')
        setMessage(`Queued ${data.name} (id ${data.id}) — runs next pipeline.`)
        setUrl('')
      }
    } catch (err) {
      setStatus('error')
      setMessage(err instanceof Error ? err.message : String(err))
    }
  }

  const isBusy = status === 'submitting'

  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <input
        type="url"
        placeholder="github.com/owner/repo"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        disabled={isBusy}
        className="text-sm px-2 py-1 rounded border bg-white w-56 disabled:opacity-50"
        aria-label="GitHub repo URL"
      />
      <button
        type="submit"
        disabled={isBusy || !url.trim()}
        className="text-sm font-medium px-2 py-1 rounded border bg-white hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isBusy ? '…' : '+ Add'}
      </button>
      {message && (
        <span
          className={
            status === 'error'
              ? 'text-xs text-red-600'
              : status === 'existed'
                ? 'text-xs text-neutral-500'
                : 'text-xs text-green-700'
          }
          title={message}
        >
          {status === 'ok' ? '✓' : status === 'existed' ? '·' : '!'} {message.slice(0, 60)}
        </span>
      )}
    </form>
  )
}
