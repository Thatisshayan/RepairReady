import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

/** Service-role client — bypasses RLS. Every query below must filter by created_by itself. */
export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

/** Verifies the caller's bearer token and returns their user id, or null if invalid. */
export async function ownerIdFromRequest(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !/^Bearer\s+\S+$/i.test(authHeader)) return null;
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  const client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
  );
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}
