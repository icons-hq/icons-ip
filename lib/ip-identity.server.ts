import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { publicIpHref, RESERVED_IP_PUBLIC_SLUGS, type AdminIpIdentity, type PublicIpReference } from './ip-identity';
export type { AdminIpIdentity } from './ip-identity';

export interface ResolvedPublicIpIdentity {
  internalId: string;
  publicSlug: string;
  isAlias: boolean;
}

function ipLinkReference(href: string): { slug: string; suffix: string } | null {
  try {
    const match = /^\/ip\/([^/?#]+)([?#].*)?$/.exec(href);
    if (match) {
      const slug = decodeURIComponent(match[1]);
      return RESERVED_IP_PUBLIC_SLUGS.has(slug) ? null : { slug, suffix: match[2] ?? '' };
    }
    if (!href.startsWith('/ip?')) return null;
    const url = new URL(href, 'https://icons.local');
    const slug = url.searchParams.get('ip');
    if (!slug || RESERVED_IP_PUBLIC_SLUGS.has(slug)) return null;
    url.searchParams.delete('ip');
    return { slug, suffix: url.search + url.hash };
  } catch {
    return null;
  }
}

/** Canonicalize stored internal links using only already-public catalog IPs. */
export async function resolvePublicIpLinks(hrefs: readonly string[], ips: readonly PublicIpReference[]): Promise<Map<string, string>> {
  const references = new Map(hrefs.flatMap(href => {
    const reference = ipLinkReference(href);
    return reference ? [[href, reference] as const] : [];
  }));
  const ipsById = new Map(ips.map(ip => [ip.id, ip]));
  const targets = new Map(ips.flatMap(ip => [[ip.id, ip] as const, [ip.publicSlug || ip.id, ip] as const]));
  const unresolved = [...new Set([...references.values()].map(reference => reference.slug).filter(slug => !targets.has(slug)))];
  if (unresolved.length > 0 && ips.length > 0) {
    const supabase = await createClient();
    const { data, error } = await supabase.from('ip_public_slug_aliases').select('slug,ip_id')
      .in('slug', unresolved).in('ip_id', [...ipsById.keys()]);
    if (error) throw new Error(`Failed to load curated IP identities: ${error.message}`);
    for (const alias of (data ?? []) as IpSlugAliasRow[]) {
      const ip = ipsById.get(alias.ip_id);
      if (ip) targets.set(alias.slug, ip);
    }
  }
  return new Map([...references].flatMap(([href, reference]) => {
    const ip = targets.get(reference.slug);
    return ip ? [[href, publicIpHref(ip) + reference.suffix] as const] : [];
  }));
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
