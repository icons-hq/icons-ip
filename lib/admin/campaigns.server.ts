import 'server-only';

import { createClient } from '@/lib/supabase/server';
import {
  ADMIN_CAMPAIGN_KINDS,
  ADMIN_CAMPAIGN_STATUSES,
  ADMIN_COIN_OFFER_STATUSES,
  type AdminCampaignKind,
  type AdminCampaignRecord,
  type AdminCampaignStatus,
  type AdminCoinExchangeOfferRecord,
  type AdminCoinOfferStatus,
} from './campaigns';

/* 캠페인 콘솔 로더 (S8 #330).
 *
 * campaigns·coin_exchange_offers 는 staff RLS select 가 열려 있어 사용자 세션
 * 클라이언트로 읽는다 — service role 을 화면 로드에 끌어들이지 않는다. draft
 * 캠페인이 목록에 보이는 것도 그 정책 덕분이고(campaigns_public_read), 그래서
 * 이 로더는 status 조건을 걸지 않는다: 운영자에게 안 보이는 초안은 편집할 수 없다.
 *
 * 카드풀 이름은 여기서 조인하지 않는다. 교환처 폼이 어차피 카드풀 선택지를
 * 받아야 해서(`getAdminCatalogRecords({ include: ['cardPools'] })`), 같은 이름을
 * 두 경로로 읽으면 두 값이 갈라질 자리가 생긴다. */

interface CampaignRow {
  id: string;
  kind: string;
  title: string;
  subtitle: string | null;
  status: string;
  starts_at: string;
  ends_at: string;
  hero_image_path: string | null;
  card_image_path: string | null;
  banner_image_path: string | null;
  featured_order: number | null;
  sections: unknown;
  updated_at: string;
}

interface CoinExchangeOfferRow {
  id: string;
  pool_id: string;
  label: string;
  coin_cost: number;
  ticket_count: number;
  status: string;
  updated_at: string;
}

export interface AdminCampaignConsoleData {
  campaigns: AdminCampaignRecord[];
  offers: AdminCoinExchangeOfferRecord[];
}

const KIND_SET = new Set<string>(ADMIN_CAMPAIGN_KINDS);
const STATUS_SET = new Set<string>(ADMIN_CAMPAIGN_STATUSES);
const OFFER_STATUS_SET = new Set<string>(ADMIN_COIN_OFFER_STATUSES);

export async function getAdminCampaignConsoleData(): Promise<AdminCampaignConsoleData> {
  const supabase = await createClient();

  const [campaignsResult, offersResult] = await Promise.all([
    supabase
      .from('campaigns')
      /* supabase-js 는 select 를 문자열 리터럴로 받아야 행 타입을 추론한다 — 쪼개면 안 된다. */
      .select('id,kind,title,subtitle,status,starts_at,ends_at,hero_image_path,card_image_path,banner_image_path,featured_order,sections,updated_at')
      .order('starts_at', { ascending: false }),
    supabase
      .from('coin_exchange_offers')
      .select('id,pool_id,label,coin_cost,ticket_count,status,updated_at')
      .order('created_at', { ascending: false }),
  ]);

  if (campaignsResult.error) {
    throw new Error(`Failed to load admin campaigns: ${campaignsResult.error.message}`);
  }
  if (offersResult.error) {
    throw new Error(`Failed to load admin coin exchange offers: ${offersResult.error.message}`);
  }

  return {
    campaigns: ((campaignsResult.data ?? []) as CampaignRow[]).map((row) => ({
      id: row.id,
      /* DB 체크가 이미 값을 좁혀 두었지만 화면은 목록을 그리는 쪽이라 모르는 값에
         멈추지 않는다 — 라벨을 못 찾은 캠페인 하나가 콘솔 전체를 닫으면 안 된다. */
      kind: (KIND_SET.has(row.kind) ? row.kind : 'event') as AdminCampaignKind,
      title: row.title,
      subtitle: row.subtitle,
      status: (STATUS_SET.has(row.status) ? row.status : 'draft') as AdminCampaignStatus,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      heroImagePath: row.hero_image_path,
      cardImagePath: row.card_image_path,
      bannerImagePath: row.banner_image_path,
      featuredOrder: row.featured_order,
      sections: Array.isArray(row.sections) ? row.sections : [],
      updatedAt: row.updated_at,
    })),
    offers: ((offersResult.data ?? []) as CoinExchangeOfferRow[]).map((row) => ({
      id: row.id,
      poolId: row.pool_id,
      label: row.label,
      coinCost: row.coin_cost,
      ticketCount: row.ticket_count,
      status: (OFFER_STATUS_SET.has(row.status) ? row.status : 'disabled') as AdminCoinOfferStatus,
      updatedAt: row.updated_at,
    })),
  };
}
