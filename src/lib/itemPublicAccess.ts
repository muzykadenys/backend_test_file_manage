import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * True if this item is public OR lies under a public folder (any ancestor has is_public).
 * Same rule drives anonymous `/public/items/*` and authenticated `canReadItem` for non-owners.
 */
export async function isPublicSelfOrAncestor(
  supabase: SupabaseClient,
  item: Record<string, unknown>,
): Promise<boolean> {
  let cur: Record<string, unknown> | null = item;
  let depth = 0;
  const maxDepth = 64;
  while (cur && depth++ < maxDepth) {
    if (cur.is_public === true) return true;
    const pid = cur.parent_id as string | null;
    if (!pid) return false;
    const { data, error } = await supabase.from('items').select('*').eq('id', pid).single();
    if (error || !data) return false;
    cur = data as Record<string, unknown>;
  }
  return false;
}
