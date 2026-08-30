/**
 * Public, read-only Supabase connection details for the optional cloud tier.
 *
 * The anon key is a PUBLIC key: it is safe in client source because every table
 * it can reach sits behind RLS that grants `select` only. The service-role key
 * is a server-only secret and must never appear anywhere in this project.
 *
 * Resolution order:
 *  1. Vite environment (`.env` → VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)
 *  2. The baked-in fallback below, so the tier also works in preview/sandbox
 *     builds where a local `.env` file is not injected.
 */

const FALLBACK_URL = 'https://xwqogzckwsmilijuqwsu.supabase.co';
/** Publishable key (project xwqogzckwsmilijuqwsu) — browser-safe behind RLS. */
const FALLBACK_ANON_KEY = 'sb_publishable_7IXFmSWXi8FE-fET90sYDg_RLqts9OT';

export interface CloudEnv {
  url: string;
  anonKey: string;
  /** Where the credentials came from — surfaced in diagnostics. */
  source: 'env' | 'fallback';
}

function fromEnv(key: string): string {
  const env =
  (import.meta as unknown as {env?: Record<string, string | undefined>;}).env ?? {};
  return (env[key] ?? '').trim();
}

export function readCloudEnv(): CloudEnv | null {
  const envUrl = fromEnv('VITE_SUPABASE_URL');
  const envKey = fromEnv('VITE_SUPABASE_ANON_KEY');
  if (envUrl && envKey) {
    return { url: envUrl.replace(/\/+$/, ''), anonKey: envKey, source: 'env' };
  }
  if (FALLBACK_URL && FALLBACK_ANON_KEY) {
    return {
      url: FALLBACK_URL.replace(/\/+$/, ''),
      anonKey: FALLBACK_ANON_KEY,
      source: 'fallback'
    };
  }
  return null;
}