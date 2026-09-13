import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

/** Service-role client — bypasses RLS. Every query below must filter by created_by itself. */
export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}
