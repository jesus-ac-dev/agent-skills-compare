#!/usr/bin/env node
// scripts/db-health.mjs
//
// Quick health report of the local Supabase DB. Run via `npm run db:health`.
// Read-only — does not modify any rows.

import { supabase } from '../src/db/supabaseClient.js'

const TOP_ERRORS_LIMIT = 10
const FRAGMENTATION_TOP = 8

function fmtCount(rows) {
  if (!rows || rows.length === 0) return '  (none)'
  const max = rows.reduce((m, r) => Math.max(m, String(r.count).length), 0)
  return rows.map((r) => `  ${String(r.count).padStart(max)} × ${r.label || '(null)'}`).join('\n')
}

async function groupCount(table, column) {
  // PostgREST caps a vanilla SELECT at 1000 rows, so we'd undercount big
  // tables. Instead: pull distinct values via pagination, then issue one
  // `head: true, count: 'exact'` request per value to get the real count.
  const pageSize = 1000
  const seen = new Set()
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(column)
      .range(from, from + pageSize - 1)
    if (error) return [{ label: `<error: ${error.message}>`, count: 0 }]
    if (!data || data.length === 0) break
    for (const row of data) seen.add(row[column] ?? '(null)')
    if (data.length < pageSize) break
    from += pageSize
  }
  const results = []
  for (const value of seen) {
    const query = supabase.from(table).select('*', { count: 'exact', head: true })
    const { count } =
      value === '(null)' ? await query.is(column, null) : await query.eq(column, value)
    results.push({ label: value, count: count ?? 0 })
  }
  return results.sort((a, b) => b.count - a.count)
}

async function reposWithoutAnyAnalysis() {
  const { data, error } = await supabase
    .from('repos')
    .select('id, name, status, files_sources!inner(analysis!left(id))')
  if (error) return -1
  let count = 0
  for (const r of data ?? []) {
    const any = (r.files_sources ?? []).some((fs) => fs.analysis && fs.analysis.id != null)
    if (!any) count++
  }
  return count
}

async function topErrors() {
  const { data, error } = await supabase
    .from('repos')
    .select('id, name, last_error, error_count, last_processed_at')
    .not('last_error', 'is', null)
    .order('last_processed_at', { ascending: false, nullsFirst: false })
    .limit(TOP_ERRORS_LIMIT)
  if (error) return []
  return data ?? []
}

async function fragmentationHint(table) {
  // Looks for likely duplicates: same prefix of 6 chars / shared root word.
  const { data, error } = await supabase.from(table).select('name')
  if (error) return []
  const counts = new Map()
  for (const r of data ?? []) {
    const root = String(r.name)
      .toLowerCase()
      .replace(/(ing|ed|s)$/, '')
      .slice(0, 6)
    if (!counts.has(root)) counts.set(root, [])
    counts.get(root).push(r.name)
  }
  return [...counts.values()]
    .filter((group) => group.length > 1)
    .sort((a, b) => b.length - a.length)
    .slice(0, FRAGMENTATION_TOP)
    .map((group) => group.join(' | '))
}

async function main() {
  console.log('\n=== DB health snapshot ===\n')

  console.log('Repos by status:')
  console.log(fmtCount(await groupCount('repos', 'status')))

  console.log('\nFiles_sources by status:')
  console.log(fmtCount(await groupCount('files_sources', 'status')))

  const lonely = await reposWithoutAnyAnalysis()
  console.log(`\nRepos with zero analysis rows: ${lonely}`)

  console.log(`\nTop ${TOP_ERRORS_LIMIT} recent errors:`)
  const errs = await topErrors()
  if (errs.length === 0) {
    console.log('  (none)')
  } else {
    for (const r of errs) {
      const when = r.last_processed_at ?? '(never finished)'
      console.log(`  #${r.id} ${r.name} (errors=${r.error_count}, ${when})`)
      console.log(`    └─ ${String(r.last_error).slice(0, 140)}`)
    }
  }

  for (const table of ['activities', 'tags']) {
    console.log(`\nLikely ${table} fragmentation (groups by 6-char root):`)
    const groups = await fragmentationHint(table)
    if (groups.length === 0) {
      console.log('  (none detected)')
    } else {
      for (const g of groups) console.log(`  ${g}`)
    }
  }

  console.log('\n--- done ---\n')
}

main().catch((err) => {
  console.error('db:health failed:', err)
  process.exit(1)
})
