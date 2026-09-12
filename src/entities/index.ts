import { supabase } from "@/lib/supabase/client";

type Row = Record<string, unknown>;

/** Maps the legacy "-updated_date" sort syntax onto real Postgres columns. */
function resolveSort(sort?: string): { column: string; ascending: boolean } {
  const raw = (sort ?? "-updated_at").trim();
  const ascending = !raw.startsWith("-");
  const key = ascending ? raw : raw.slice(1);
  const column = key === "updated_date" ? "updated_at" : key === "created_date" ? "created_at" : key;
  return { column, ascending };
}

/**
 * Thin Supabase-backed entity client exposing a small `list`/`filter`/`create`/`update`/`delete`
 * surface for the rest of the app's lib code. Row-level ownership is enforced by Postgres RLS
 * (created_by = auth.uid()), not by anything in this client.
 */
function makeEntity(table: string) {
  return {
    async list(sort?: string, limit = 200): Promise<Row[]> {
      const { column, ascending } = resolveSort(sort);
      const { data, error } = await supabase
        .from(table)
        .select("*")
        .order(column, { ascending })
        .limit(limit);
      if (error) throw error;
      return data ?? [];
    },

    async filter(query: Row, sort?: string, limit = 200): Promise<Row[]> {
      const { column, ascending } = resolveSort(sort);
      let builder = supabase.from(table).select("*");
      for (const [key, value] of Object.entries(query)) {
        builder = builder.eq(key, value);
      }
      const { data, error } = await builder.order(column, { ascending }).limit(limit);
      if (error) throw error;
      return data ?? [];
    },

    async create(payload: Row): Promise<Row> {
      const { data, error } = await supabase.from(table).insert(payload).select().single();
      if (error) throw error;
      return data;
    },

    async update(id: string, payload: Row): Promise<Row> {
      const { data, error } = await supabase.from(table).update(payload).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },

    async delete(id: string): Promise<void> {
      const { error } = await supabase.from(table).delete().eq("id", id);
      if (error) throw error;
    },
  };
}

export const User = {
  async me() {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    return data.user;
  },
  async logout() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  },
};

export const RepairJob = makeEntity("repair_jobs");
export const CallAttempt = makeEntity("call_attempts");
export const RepairBrief = makeEntity("repair_briefs");
