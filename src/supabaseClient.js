import { createClient } from '@supabase/supabase-js';

export function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey || url.includes('project-ref') || serviceKey.includes('replace-with-')) {
    return { client: null, enabled: false, reason: 'Supabase credentials missing or placeholder values' };
  }

  const client = createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  return { client, enabled: true, reason: 'Supabase enabled' };
}
