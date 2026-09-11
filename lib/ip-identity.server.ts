import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { getSupabaseConfig } from '@/lib/supabase/config';
import type { AdminIpIdentity } from './ip-identity';
export type { AdminIpIdentity } from './ip-identity';

export interface ResolvedPublicIpIdentity {
  internalId: string;
  publicSlug: string;
  isAlias: boolean;
}

interface IpIdentityRow {
  id: string;
  public_slug: string | null;
  archived_at: string | null;
  published_at: string | null;
}

interface IpSlugAliasRow {
  slug: string;
  ip_id: string;
}

function isPublic(row: IpIdentityRow): boolean {
  return Boolean(row.public_slug && !row.archived_at && row.published_at);
}

async function loadIpById(id: string): Promise<IpIdentityRow | null> {
  const supabase = await createClient();
  const result = await supabase
    .from('ips')
    .select('id,public_slug,archived_at,published_at')
    .eq('id', id)
    .maybeSingle();
  if (result.error) throw new Error(`Failed to resolve IP identity: ${result.error.message}`);
  return (result.data as IpIdentityRow | null) ?? null;
}

/**
 * Resolve a public path segment without allowing an alias to become a second
 * mutable identity. Old aliases are only a lookup into the current IP row.
 */
export async function resolvePublicIpIdentity(value: string): Promise<ResolvedPublicIpIdentity | null> {
  /* The existing local/mock catalog has no identity table. Keep its public
     routes usable while the configured Supabase path gets canonical aliases. */
  if (!getSupabaseConfig().isConfigured) {
    return { internalId: value, publicSlug: value, isAlias: false };
  }

  const supabase = await createClient();
  const canonicalResult = await supabase
    .from('ips')
    .select('id,public_slug,archived_at,published_at')
    .eq('public_slug', value)
    .maybeSingle();
  if (canonicalResult.error) {
    throw new Error(`Failed to resolve IP identity: ${canonicalResult.error.message}`);
  }

  const canonical = (canonicalResult.data as IpIdentityRow | null) ?? null;
  if (canonical) {
    return isPublic(canonical)
      ? { internalId: canonical.id, publicSlug: canonical.public_slug!, isAlias: false }
      : null;
  }

  const aliasResult = await supabase
    .from('ip_public_slug_aliases')
    .select('slug,ip_id')
    .eq('slug', value)
    .maybeSingle();
  if (aliasResult.error) throw new Error(`Failed to resolve IP alias: ${aliasResult.error.message}`);

  const alias = (aliasResult.data as IpSlugAliasRow | null) ?? null;
  if (!alias) return null;

  const target = await loadIpById(alias.ip_id);
  if (!target || !isPublic(target)) return null;
  return { internalId: target.id, publicSlug: target.public_slug!, isAlias: true };
}

export async function loadAdminIpIdentity(internalId: string): Promise<AdminIpIdentity | null> {
  const supabase = await createClient();
  const [ipResult, aliasesResult] = await Promise.all([
    supabase
      .from('ips')
      .select('id,public_slug,archived_at,published_at')
      .eq('id', internalId)
      .maybeSingle(),
    supabase
      .from('ip_public_slug_aliases')
      .select('slug,ip_id')
      .eq('ip_id', internalId)
      .order('slug'),
  ]);

  if (ipResult.error || aliasesResult.error) {
    throw new Error('IP 공개 식별자를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
  }
  const row = (ipResult.data as IpIdentityRow | null) ?? null;
  if (!row || !row.public_slug) return null;

  return {
    internalId: row.id,
    publicSlug: row.public_slug,
    aliases: ((aliasesResult.data ?? []) as IpSlugAliasRow[]).map((alias) => alias.slug),
  };
}
