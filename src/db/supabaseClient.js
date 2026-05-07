import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Return a mock object if URL/Key are missing to allow dry-runs/imports without crashing
export const supabase = (supabaseUrl && supabaseKey)
    ? createClient(supabaseUrl, supabaseKey)
    : {
        from: () => ({
            upsert: () => ({ select: () => ({ single: () => ({ data: { id: 'mock-id' }, error: null }) }) }),
            insert: () => ({ error: null }),
            select: () => ({ single: () => ({ data: { id: 'mock-id' }, error: null }) })
        })
    };

if (!supabaseUrl || !supabaseKey) {
  console.warn('Supabase URL or Key missing. Using mock database client.');
}
