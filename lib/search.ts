import 'server-only';

import { DATA } from '@/lib/data';
import { imageBg, normalizePublicMediaPath, PUBLIC_MEDIA_BUCKET } from '@/lib/media';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { resolveCatalogSource } from './catalog-source';

export type SearchResultKind = 'ip' | 'good' | 'card' | 'post' | 'tag';

export interface SearchResult {
  kind: SearchResultKind;
  id: string;
  label: string;
  subtitle: string | null;
  ipId: string | null;
  ipTitle: string | null;
  imagePath: string | null;
  bg: string | null;
  accent: string | null;
  score: number;
}

export interface SearchResultGroup {
  kind: SearchResultKind;
  label: string;
  results: SearchResult[];
}

export interface SearchSnapshot {
  source: 'supabase' | 'mock';
  query: string;
  displayedTotal: number;
  groups: SearchResultGroup[];
}

const MAX_QUERY_LENGTH = 80;
const DEFAULT_PER_GROUP_LIMIT = 6;
const GROUP_LABELS: Record<SearchResultKind, string> = {
  ip: 'IP',
  good: '굿즈',
  card: '카드',
  post: '포스트',
  tag: '태그',
};
const GROUP_ORDER: SearchResultKind[] = ['ip', 'good', 'card', 'post', 'tag'];

interface SearchRpcRow {
  kind: string | null;
  id: string | null;
  label: string | null;
  subtitle: string | null;
  ip_id: string | null;
  ip_title: string | null;
  image_path: string | null;
  bg: string | null;
  accent: string | null;
  score: number | string | null;
}

export function normalizeSearchQuery(rawQuery: string | string[] | null | undefined) {
  const value = Array.isArray(rawQuery) ? rawQuery[0] : rawQuery;
  return (value ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_QUERY_LENGTH);
}

function isSearchResultKind(value: string | null): value is SearchResultKind {
  return value === 'ip' || value === 'good' || value === 'card' || value === 'post' || value === 'tag';
}

function toSearchResult(row: SearchRpcRow, imageUrlForPath?: (path: string) => string): SearchResult | null {
  if (!isSearchResultKind(row.kind) || !row.id || !row.label) return null;
  const imagePath = row.kind === 'post' ? null : row.image_path;
  const publicImageUrl = imagePath ? imageUrlForPath?.(imagePath) : null;

  return {
    kind: row.kind,
    id: row.id,
    label: row.label,
    subtitle: row.subtitle,
    ipId: row.ip_id,
    ipTitle: row.ip_title,
    imagePath,
    bg: publicImageUrl ? imageBg(publicImageUrl) : row.bg,
    accent: row.accent,
    score: Number(row.score ?? 0),
  };
}

function groupSearchResults(results: SearchResult[]) {
  return GROUP_ORDER.map((kind) => ({
    kind,
    label: GROUP_LABELS[kind],
    results: results.filter((result) => result.kind === kind),
  })).filter((group) => group.results.length > 0);
}

function emptySnapshot(source: SearchSnapshot['source'], query: string): SearchSnapshot {
  return {
    source,
    query,
    displayedTotal: 0,
    groups: [],
  };
}

function searchableText(parts: Array<string | number | null | undefined>) {
  return parts.filter((part) => part !== null && part !== undefined).join(' ').toLowerCase();
}

function matchesQuery(query: string, parts: Array<string | number | null | undefined>) {
  return searchableText(parts).includes(query.toLowerCase());
}

function mockScore(query: string, primary: string) {
  return primary.toLowerCase().includes(query.toLowerCase()) ? 1 : 0.5;
}

function getMockSearchSnapshot(query: string): SearchSnapshot {
  const ipsByTitle = new Map(DATA.IPS.map((ip) => [ip.title, ip]));
  const ipsById = new Map(DATA.IPS.map((ip) => [ip.id, ip]));

  const results: SearchResult[] = [
    ...DATA.IPS.filter((ip) =>
      matchesQuery(query, [ip.title, ip.sub, ip.v.label, ip.tagline, ip.synopsis]),
    ).map((ip) => ({
      kind: 'ip' as const,
      id: ip.id,
      label: ip.title,
      subtitle: `${ip.v.label} · ${ip.sub}`,
      ipId: ip.id,
      ipTitle: ip.title,
      imagePath: null,
      bg: ip.bg,
      accent: ip.v.color,
      score: mockScore(query, ip.title),
    })),
    ...DATA.GOODS.filter((good) =>
      matchesQuery(query, [good.name, good.type, good.badge, ipsById.get(good.ip)?.title]),
    ).map((good) => {
      const ip = ipsById.get(good.ip);
      return {
        kind: 'good' as const,
        id: good.id,
        label: good.name,
        subtitle: [ip?.title, good.type].filter(Boolean).join(' · '),
        ipId: good.ip,
        ipTitle: ip?.title ?? null,
        imagePath: null,
        bg: good.img,
        accent: ip?.v.color ?? null,
        score: mockScore(query, good.name),
      };
    }),
    ...DATA.CARDS.filter((card) =>
      matchesQuery(query, [card.name, card.no, card.rarity, ipsById.get(card.ip)?.title]),
    ).map((card) => {
      const ip = ipsById.get(card.ip);
      return {
        kind: 'card' as const,
        id: card.id,
        label: card.name,
        subtitle: [ip?.title, card.rarity, card.no].filter(Boolean).join(' · '),
        ipId: card.ip,
        ipTitle: ip?.title ?? null,
        imagePath: null,
        bg: card.bg,
        accent: ip?.v.color ?? null,
        score: mockScore(query, card.name),
      };
    }),
    ...DATA.POSTS.filter((post) =>
      matchesQuery(query, [post.text, post.tag, post.ipName, post.user]),
    ).map((post) => {
      const ip = ipsByTitle.get(post.ipName);
      return {
        kind: 'post' as const,
        id: post.id,
        label: post.text,
        subtitle: `${post.ipName} · #${post.tag}`,
        ipId: ip?.id ?? null,
        ipTitle: post.ipName,
        imagePath: null,
        bg: post.img,
        accent: ip?.v.color ?? post.avatar,
        score: mockScore(query, post.text),
      };
    }),
    ...Array.from(new Set(DATA.POSTS.map((post) => post.tag)))
      .filter((tag) => matchesQuery(query, [tag]))
      .map((tag) => ({
        kind: 'tag' as const,
        id: tag,
        label: `#${tag}`,
        subtitle: '커뮤니티 태그',
        ipId: null,
        ipTitle: null,
        imagePath: null,
        bg: null,
        accent: null,
        score: mockScore(query, tag),
      })),
  ].sort((left, right) => right.score - left.score);

  return {
    source: 'mock',
    query,
    displayedTotal: results.length,
    groups: groupSearchResults(results),
  };
}

export async function getSearchSnapshot(rawQuery: string | string[] | null | undefined): Promise<SearchSnapshot> {
  const query = normalizeSearchQuery(rawQuery);
  const source = resolveCatalogSource({ isSupabaseConfigured: getSupabaseConfig().isConfigured });

  if (!query) return emptySnapshot(source, query);
  if (source === 'mock') return getMockSearchSnapshot(query);

  const supabase = await createClient();
  const imageUrlForPath = (path: string) => {
    const { data } = supabase.storage
      .from(PUBLIC_MEDIA_BUCKET)
      .getPublicUrl(normalizePublicMediaPath(path));
    return data.publicUrl;
  };
  const { data, error } = await supabase.rpc('search_public_content', {
    search_query: query,
    per_group_limit: DEFAULT_PER_GROUP_LIMIT,
  });

  if (error) {
    throw new Error(`Failed to search content: ${error.message}`);
  }

  const results = ((data ?? []) as SearchRpcRow[])
    .map((row) => toSearchResult(row, imageUrlForPath))
    .filter((result): result is SearchResult => result !== null);

  return {
    source,
    query,
    displayedTotal: results.length,
    groups: groupSearchResults(results),
  };
}
