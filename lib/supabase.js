import { createClient } from "@supabase/supabase-js";

// Single browser-side Supabase client for the whole app. Both values are safe to ship in client
// code: the URL is public, and the publishable/anon key only grants what the database's
// row-level-security policies allow (see supabase/schema.sql — every row is scoped to its owner).
// The real secret (service-role key) is never referenced anywhere in this codebase.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Surfaced loudly in the console rather than failing silently with a cryptic network error later.
  console.error(
    "StudyOS: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set — " +
    "auth and data persistence will not work. Add them to .env (local) and the host's env vars (deployed)."
  );
}

// Fall back to syntactically-valid placeholders when env is missing so importing this module never
// throws (createClient rejects an empty URL). Any real call will just fail loudly at runtime, and
// the console.error above already names the actual cause.
export const supabase = createClient(
  url || "https://placeholder.supabase.co",
  anonKey || "placeholder-anon-key",
  {
    auth: {
      persistSession: true,     // keep the user logged in across reloads (localStorage-backed session)
      autoRefreshToken: true,   // refresh the access token before it expires
      detectSessionInUrl: true, // needed if we ever add magic-link / OAuth redirects
    },
  }
);
