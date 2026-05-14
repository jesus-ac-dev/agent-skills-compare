import { supabase } from './supabaseClient.js'
import logger from '../utils/logger.js'

/**
 * Resolves a name to its id in a closed-vocabulary lookup table.
 * Case-insensitive match. Returns null on empty input or miss.
 */
export async function resolveClosedId(table, name) {
  if (!name || !String(name).trim()) return null
  const { data, error } = await supabase
    .from(table)
    .select('id')
    .ilike('name', String(name).trim())
    .maybeSingle()

  if (error) {
    logger.debug(`resolveClosedId(${table}, ${name}) error: ${error.message}`)
    return null
  }
  return data?.id ?? null
}

/**
 * Upserts a name (lower-cased) into an open-vocabulary lookup table.
 * Returns the id of the existing or newly inserted row, or null on empty input.
 */
export async function upsertOpenId(table, name) {
  if (!name || !String(name).trim()) return null
  const normalised = String(name).trim().toLowerCase()

  const { data, error } = await supabase
    .from(table)
    .upsert({ name: normalised }, { onConflict: 'name' })
    .select('id')
    .single()

  if (error) {
    logger.warn(`upsertOpenId(${table}, ${name}) error: ${error.message}`)
    return null
  }
  return data?.id ?? null
}

/**
 * Loads vocabularies (closed + open) from the DB to inject in the
 * classifier system prompt.
 *
 * - classes, domains: closed lists — enums in the response schema.
 * - activities: open list (classifier may invent new), passed as a
 *   "prefer these" hint to reduce fragmentation in re-runs.
 *
 * To keep prompts bounded as the open vocabularies grow, activities are
 * capped at the most-used 100. Less common ones drop off the hint but are
 * still allowed (the classifier can still emit them).
 */
export async function loadClosedVocabulary() {
  const [classes, domains, activities] = await Promise.all([
    supabase.from('classes').select('name'),
    supabase.from('domains').select('name'),
    supabase.from('activities').select('name')
  ])

  return {
    classes: (classes.data ?? []).map((r) => r.name).sort(),
    domains: (domains.data ?? []).map((r) => r.name).sort(),
    // Activities are semi-open: hint, not enum. Sort + cap so the prompt
    // stays bounded regardless of DB growth.
    activities: (activities.data ?? [])
      .map((r) => r.name)
      .sort()
      .slice(0, 100)
  }
}
