// lib/supabase-server.ts
import { createClient } from '@supabase/supabase-js'

// service_role — server-side ONLY. Never import this from a "use client" component.
const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  // Throwing at module load surfaces the misconfig early in dev.
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for server routes')
}

export const supabaseServer = createClient(url, key)
