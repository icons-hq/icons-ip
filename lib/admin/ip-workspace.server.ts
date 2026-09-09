import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { imageUrlFromBg, normalizePublicMediaPath, PUBLIC_MEDIA_BUCKET } from '@/lib/media';
import {
  IP_INDEX_PAGE_SIZE, type AdminIpIndexData, type AdminIpSummary, type AdminIpWorkspaceData,
  type IpIndexFilters, type IpWorkspaceTab,
} from './ip-workspace';

function summary(row: { id: string; title: string; vertical_key: string; archived_at: string | null; published_at: string | null; featured: boolean; sort_order: number }): AdminIpSummary {
  return { id: row.id, title: row.title, verticalKey: row.vertical_key, archivedAt: row.archived_at,
    publishedAt: row.published_at, featured: row.featured, sortOrder: row.sort_order };
}

export async function loadAdminIpIndex(filters: IpIndexFilters): Promise<AdminIpIndexData> {
  const supabase = await createClient();
  let query = supabase.from('ips').select('id,title,vertical_key,archived_at,published_at,featured,sort_order', { count: 'exact' });
  if (filters.query) {
    // Quoted PostgREST operands keep commas, parentheses and quotes inside the search term.
    const term = JSON.stringify(`%${filters.query.replace(/[\\%_]/g, '\\$&')}%`);
    query = query.or(`id.ilike.${term},title.ilike.${term}`);
  }
  if (filters.vertical) query = query.eq('vertical_key', filters.vertical);
  if (filters.status === 'archived') query = query.not('archived_at', 'is', null);
  else if (filters.status !== 'all') {
    query = query.is('archived_at', null);
    if (filters.status === 'draft') query = query.is('published_at', null);
    if (filters.status === 'published') query = query.not('published_at', 'is', null);
  }
  const [result, verticals] = await Promise.all([
    query.order('sort_order').order('id').range((filters.page - 1) * IP_INDEX_PAGE_SIZE, filters.page * IP_INDEX_PAGE_SIZE - 1),
    supabase.from('verticals').select('key,label').order('key'),
  ]);
  if (result.error || verticals.error) throw new Error('IP 목록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
  const total = result.count ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / IP_INDEX_PAGE_SIZE));
  if (filters.page > lastPage) return loadAdminIpIndex({ ...filters, page: lastPage });
  return { ips: (result.data ?? []).map(summary), total, filters, verticals: verticals.data ?? [] };
}

export async function loadAdminIpWorkspace(id: string, tab: IpWorkspaceTab): Promise<AdminIpWorkspaceData | null> {
  const supabase = await createClient();
  const [result, verticals] = await Promise.all([
    supabase.from('ips').select('id,archived_at,published_at,title,sub,vertical_key,tagline,synopsis,glyph,bg,image_path,featured,fans_count').eq('id', id).maybeSingle(),
    supabase.from('verticals').select('key,label,color').order('key'),
  ]);
  if (result.error || verticals.error) throw new Error('IP 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
  const row = result.data;
  if (!row) return null;
  const data: AdminIpWorkspaceData = {
    ip: { id: row.id, archivedAt: row.archived_at, publishedAt: row.published_at, title: row.title,
      sub: row.sub, verticalKey: row.vertical_key, tagline: row.tagline, synopsis: row.synopsis,
      glyph: row.glyph, bg: row.bg, imagePath: row.image_path,
      imageUrl: row.image_path ? supabase.storage.from(PUBLIC_MEDIA_BUCKET).getPublicUrl(normalizePublicMediaPath(row.image_path)).data.publicUrl : imageUrlFromBg(row.bg),
      featured: row.featured, fansCount: row.fans_count ?? 0 },
    tab, verticals: verticals.data ?? [], directory: [], related: [], relatedTotal: 0,
  };
  if (tab === 'exposure') {
    for (let offset = 0; ; offset += 1000) {
      const directory = await supabase.from('ips').select('id,title,vertical_key,archived_at,published_at,featured,sort_order')
        .order('sort_order').order('id').range(offset, offset + 999);
      if (directory.error) throw new Error('IP 노출 순서를 불러오지 못했습니다.');
      data.directory.push(...(directory.data ?? []).map(summary));
      if ((directory.data?.length ?? 0) < 1000) break;
    }
  } else if (tab === 'goods') {
    const result = await supabase.from('goods').select('id,name,price,archived_at', { count: 'exact' }).eq('ip_id', id).order('name').order('id').limit(100);
    if (result.error) throw new Error('연결된 상품을 불러오지 못했습니다.');
    data.related = (result.data ?? []).map((good) => ({ id: good.id, title: good.name, detail: `${good.price.toLocaleString('ko-KR')}원${good.archived_at ? ' · 보관' : ''}` }));
    data.relatedTotal = result.count ?? 0;
  } else if (tab === 'pools') {
    const result = await supabase.from('card_pools').select('id,name,active_from', { count: 'exact' }).eq('ip_id', id).order('active_from', { ascending: false }).order('id').limit(100);
    if (result.error) throw new Error('연결된 카드풀을 불러오지 못했습니다.');
    data.related = (result.data ?? []).map((pool) => ({ id: pool.id, title: pool.name, detail: `시작 ${pool.active_from.slice(0, 10)}` }));
    data.relatedTotal = result.count ?? 0;
  } else if (tab === 'events') {
    const result = await supabase.from('events').select('id,title,starts_at,archived_at', { count: 'exact' }).eq('ip_id', id).order('starts_at', { ascending: false }).order('id').limit(100);
    if (result.error) throw new Error('연결된 이벤트를 불러오지 못했습니다.');
    data.related = (result.data ?? []).map((event) => ({ id: event.id, title: event.title, detail: `${event.starts_at?.slice(0, 10) ?? '일정 미정'}${event.archived_at ? ' · 보관' : ''}` }));
    data.relatedTotal = result.count ?? 0;
  }
  return data;
}
