#!/usr/bin/env node
// scripts/db-canonicalize.mjs
//
// Replace fragmented activity/tag rows with their canonical names.
// Map lives in `config/canonical-aliases.json` as { fromName: toName }.
//
// Usage:
//   npm run db:canonicalize           ← dry-run (default)
//   npm run db:canonicalize -- --apply
//
// Behaviour:
//   - Same map is applied to BOTH `activities` and `tags` tables.
//   - Entries where `from === to` are skipped (no-op).
//   - For each real rename: find row(s) named `from`, find or create
//     a row named `to`, update analysis_activities/analysis_tags to
//     point to the `to` id, delete the `from` row. M2M rows that
//     would create a duplicate (analysis already linked to `to`)
//     are simply deleted.

import { readFile } from 'node:fs/promises'
import { supabase } from '../src/db/supabaseClient.js'

const CONFIG_PATH = new URL('../config/canonical-aliases.json', import.meta.url)
const APPLY = process.argv.includes('--apply')

const TARGETS = [
  { table: 'activities', m2m: 'analysis_activities', fk: 'activity_id' },
  { table: 'tags', m2m: 'analysis_tags', fk: 'tag_id' }
]

async function findId(table, name) {
  const { data } = await supabase.from(table).select('id').ilike('name', name).maybeSingle()
  return data?.id ?? null
}

async function findOrCreateId(table, name) {
  const existing = await findId(table, name)
  if (existing) return existing
  if (!APPLY) return -1 // sentinel for dry-run
  const { data, error } = await supabase
    .from(table)
    .insert({ name: name.toLowerCase() })
    .select('id')
    .single()
  if (error) throw new Error(`insert ${table} ${name}: ${error.message}`)
  return data.id
}

async function migrateOne({ table, m2m, fk }, fromName, toName) {
  const fromId = await findId(table, fromName)
  if (!fromId) return { table, skipped: true, reason: 'from not found' }

  const toId = await findOrCreateId(table, toName)

  // Find M2M rows that point to fromId.
  const { data: links } = await supabase.from(m2m).select(`analysis_id, ${fk}`).eq(fk, fromId)
  const analysisIds = (links ?? []).map((r) => r.analysis_id)
  if (analysisIds.length === 0) {
    // No M2M links — just delete the orphan row.
    if (APPLY) await supabase.from(table).delete().eq('id', fromId)
    return { table, from: fromName, to: toName, links: 0, removedDup: 0, status: 'orphan' }
  }

  // Of those analyses, which already link to toId? Those duplicates must be
  // collapsed (UNIQUE constraint on (analysis_id, fk) would otherwise reject).
  const { data: existingTo } = await supabase
    .from(m2m)
    .select('analysis_id')
    .eq(fk, toId)
    .in('analysis_id', analysisIds)
  const dupAnalysisIds = new Set((existingTo ?? []).map((r) => r.analysis_id))

  let removedDup = 0
  let redirected = 0
  for (const aid of analysisIds) {
    if (dupAnalysisIds.has(aid)) {
      if (APPLY) await supabase.from(m2m).delete().eq('analysis_id', aid).eq(fk, fromId)
      removedDup++
    } else {
      if (APPLY) {
        await supabase
          .from(m2m)
          .update({ [fk]: toId })
          .eq('analysis_id', aid)
          .eq(fk, fromId)
      }
      redirected++
    }
  }

  if (APPLY) await supabase.from(table).delete().eq('id', fromId)

  return { table, from: fromName, to: toName, links: redirected, removedDup, status: 'merged' }
}

async function main() {
  const raw = await readFile(CONFIG_PATH, 'utf8')
  const aliases = JSON.parse(raw)

  const renames = Object.entries(aliases).filter(([from, to]) => from !== to)
  if (renames.length === 0) {
    console.log('No real renames in canonical-aliases.json (all keys map to themselves).')
    return
  }

  console.log(
    `\n${APPLY ? '=== APPLYING' : '=== DRY-RUN'} ${renames.length} renames across activities + tags ===\n`
  )

  let totalRedirected = 0
  let totalDup = 0
  let totalSkipped = 0

  for (const [fromName, toName] of renames) {
    for (const target of TARGETS) {
      const result = await migrateOne(target, fromName, toName)
      if (result.skipped) {
        totalSkipped++
      } else if (result.status === 'orphan') {
        console.log(`  ${result.table.padEnd(11)} ${fromName} → ${toName}   (orphan, no M2M)`)
      } else {
        totalRedirected += result.links
        totalDup += result.removedDup
        console.log(
          `  ${result.table.padEnd(11)} ${fromName} → ${toName}   ` +
            `(redirected ${result.links}, removed ${result.removedDup} duplicates)`
        )
      }
    }
  }

  console.log(
    `\nTotal: redirected ${totalRedirected} M2M rows, removed ${totalDup} duplicates, skipped ${totalSkipped} (not in DB).`
  )
  if (!APPLY) {
    console.log('Dry-run — nothing was written. Re-run with --apply to commit.\n')
  } else {
    console.log('Done.\n')
  }
}

main().catch((err) => {
  console.error('db:canonicalize failed:', err)
  process.exit(1)
})
