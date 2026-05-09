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
    logger.debug(`upsertOpenId(${table}, ${name}) error: ${error.message}`)
    return null
  }
  return data?.id ?? null
}

/**
 * Loads closed vocabularies (classes, domains) from the DB.
 * Used to construct the Gemini responseSchema enums at runtime.
 */
export async function loadClosedVocabulary() {
  const [classes, domains] = await Promise.all([
    supabase.from('classes').select('name'),
    supabase.from('domains').select('name')
  ])

  return {
    classes: (classes.data ?? []).map((r) => r.name).sort(),
    domains: (domains.data ?? []).map((r) => r.name).sort()
  }
}
