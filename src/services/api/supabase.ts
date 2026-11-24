import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? '';
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';
export const authConfigured = Boolean(
  url && key && !url.includes('your-project') && !key.includes('replace_with'),
);
export const supabase = authConfigured
  ? createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl:
          typeof window !== 'undefined' && window.location.pathname !== '/auth/callback',
        flowType: 'pkce',
      },
    })
  : null;

export function requireSupabase() {
  if (!supabase) throw new Error('Supabase 환경변수를 확인하고 Vite를 다시 시작하세요.');
  return supabase;
}
