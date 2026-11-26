import 'server-only';
import { unstable_rethrow } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { OriginGoodsImpact, OriginRegionalFeeUse, OriginSaveImpact } from './fulfillment-origins';
import { loadGoodsFulfillmentOptions } from './fulfillment-origins.server';
import { shippingRegionPolicyInEffect, shippingRegionPolicyScheduled, type ShippingRegionPolicy } from './shipping-regions';

export type { OriginGoodsImpact, OriginRegionalFeeUse, OriginSaveImpact } from './fulfillment-origins';

/*
 * 출고지·택배사를 바꾸거나 끄기 전에 알릴 영향을 읽는다. 읽기만 한다 — 저장·계산·상태 변경은 하지 않는다.
 * 권한은 부르는 화면이 먼저 확인하고(`requireAdminScreenAccess`), 읽기는 DB 권한(상품·지역별 추가배송비 읽기 `catalog.read`)을 그대로 따른다.
 * 읽지 못하면 던지지 않고 비워 돌려준다 — 화면은 '모른다'고 말하고, 안전하다고 말하지 않는다. 쓰는 곳: 배송정보 관리(출고지), 택배사 관리.
 */

/** 지역별 추가배송비를 쓰지 않는 출고지의 값. 쓰는 쪽이 바꿔도 다른 곳에 번지지 않게 매번 새로 만든다. */
const notManaged = (): OriginRegionalFeeUse => ({ managed: false, inEffectCarrierCodes: [], scheduledCarrierCodes: [] });

/**
 * 출고지마다 영향받는 공개 상품 수. 게시 상태 '공개'(공개 중이고 보관되지 않음)인 상품을 센다. 출고지가 사용 안 함이 되면 이 상품들은
 * 고객에게 계속 보이지만 새 주문을 받지 못한다(견적·주문이 거절된다).
 * 반환: 출고지 번호 → 수. 읽지 못한 출고지는 키가 없다.
 */
export async function loadOriginGoodsImpact(originIds: readonly string[]): Promise<Record<string, OriginGoodsImpact>> {
  const ids = [...new Set(originIds)];
  if (!ids.length) return {};
  try {
    const client = await createClient();
    const result: Record<string, OriginGoodsImpact> = {};
    await Promise.all(ids.map(async (id) => {
      const publicGoods = () => client.from('goods').select('id', { count: 'exact', head: true })
        .eq('origin_id', id).is('archived_at', null).not('published_at', 'is', null);
      const [all, policy] = await Promise.all([publicGoods(), publicGoods().eq('shipping_fee_type', 'policy')]);
      if (all.error || policy.error || typeof all.count !== 'number' || typeof policy.count !== 'number') return;
      result[id] = { publicGoods: all.count, policyFeeGoods: policy.count };
    }));
    return result;
  } catch (error) {
    unstable_rethrow(error);
    return {};
  }
}

/* 정책 행에서 보는 칸만 읽는다. 상태는 'active'만 적용 중일 수 있고, 모르는 상태는 적용 중이 아닌 것으로 본다. */
type PolicyRow = Pick<ShippingRegionPolicy, 'originId' | 'carrierCode' | 'status' | 'startsAt' | 'endsAt'>;
const isPolicyRow = (row: unknown): row is PolicyRow => {
  const value = row as Record<string, unknown> | null;
  return Boolean(value) && typeof value === 'object' && typeof value!.originId === 'string' && typeof value!.carrierCode === 'string' && typeof value!.status === 'string'
    && (value!.startsAt === null || typeof value!.startsAt === 'string') && (value!.endsAt === null || typeof value!.endsAt === 'string');
};
const isAdoptionRow = (row: unknown): row is { originId: string; managedFrom: string } => {
  const value = row as Record<string, unknown> | null;
  return Boolean(value) && typeof value === 'object' && typeof value!.originId === 'string' && typeof value!.managedFrom === 'string' && Number.isFinite(Date.parse(value!.managedFrom));
};

/**
 * 지역별 추가배송비 정책·도입 기록에서 출고지마다 사용 여부를 가린다. `private.apply_shipping_region_quote`와 같은 기준이다:
 * 도입 시각이 지났으면 사용하는 출고지이고, 활성이면서 적용 기간 안인 정책의 택배사가 지금 적용 중이다.
 * 행이 하나라도 읽히지 않으면 어느 쪽으로도 단정할 수 없어 null이다. 키가 없는 출고지는 지역별 추가배송비를 쓰지 않는다.
 */
export function deriveOriginRegionalFeeUse(policies: unknown[], adoptions: unknown[], now: number): Record<string, OriginRegionalFeeUse> | null {
  if (!policies.every(isPolicyRow) || !adoptions.every(isAdoptionRow)) return null;
  const result: Record<string, OriginRegionalFeeUse> = {};
  const slot = (originId: string) => (result[originId] ??= notManaged());
  for (const adoption of adoptions) if (Date.parse(adoption.managedFrom) <= now) slot(adoption.originId).managed = true;
  for (const policy of policies) {
    /* 이 정책의 택배사가 출고지의 기본 택배사였다면 적용 중인가를 묻는다(정책 쪽 조건만 본다). */
    const asDefault = { id: policy.originId, defaultCarrier: policy.carrierCode };
    const target = shippingRegionPolicyInEffect(policy, asDefault, now) ? 'inEffectCarrierCodes' : shippingRegionPolicyScheduled(policy, now) ? 'scheduledCarrierCodes' : null;
    if (target && !slot(policy.originId)[target].includes(policy.carrierCode)) slot(policy.originId)[target].push(policy.carrierCode);
  }
  return result;
}

/**
 * 출고지마다 지역별 추가배송비 사용 여부와 지금 적용 중인(또는 시작 전인) 택배사. 읽지 못하면 null.
 * 반환: 출고지 번호 → 사용 여부. 키가 없는 출고지는 쓰지 않는다.
 */
export async function loadOriginRegionalFeeUse(now = Date.now()): Promise<Record<string, OriginRegionalFeeUse> | null> {
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_list_shipping_region_policies');
    if (error || !data || !Array.isArray(data.policies) || !Array.isArray(data.adoptions)) return null;
    return deriveOriginRegionalFeeUse(data.policies, data.adoptions, now);
  } catch (error) {
    unstable_rethrow(error);
    return null;
  }
}

/** 배송정보 관리가 출고지 하나를 저장하기 전에 알릴 영향: 영향받는 공개 상품 수와 지역별 추가배송비 사용 여부. 읽지 못한 쪽은 null. */
export async function loadOriginSaveImpact(originId: string, now = Date.now()): Promise<OriginSaveImpact> {
  const [goods, regional] = await Promise.all([loadOriginGoodsImpact([originId]), loadOriginRegionalFeeUse(now)]);
  return { goods: goods[originId] ?? null, regionalFee: regional ? (regional[originId] ?? notManaged()) : null };
}

/** 택배사를 기본 택배사로 쓰는 출고지 한 곳. */
export interface CarrierOriginUse {
  originId: string; originName: string;
  /** 새 주문을 받는 출고지인가. */
  active: boolean;
  /**
   * 지역별 추가배송비를 쓰는 출고지인가. 쓰는 출고지는 이 택배사를 끄면 새 주문이 막힌다(기본 택배사가 사용 안 함이면 지역별 추가배송비를 적용할 수 없다).
   * 지역별 추가배송비를 읽지 못했으면 null.
   */
  usesRegionalFee: boolean | null;
}

/**
 * 택배사 코드마다 그 택배사를 기본 택배사로 쓰는 출고지(사용 안 함인 출고지도 포함). 키가 없는 택배사는 쓰는 출고지가 없다.
 * 출고지 목록을 읽지 못하면 null — 쓰는 출고지가 없다는 뜻이 아니므로 화면은 끌 수 있다고 말하지 않는다.
 */
export async function loadCarrierOriginUses(now = Date.now()): Promise<Record<string, CarrierOriginUse[]> | null> {
  try {
    const [origins, regional] = await Promise.all([loadGoodsFulfillmentOptions(), loadOriginRegionalFeeUse(now)]);
    const uses: Record<string, CarrierOriginUse[]> = {};
    for (const origin of origins) {
      if (!origin.defaultCarrier) continue;
      (uses[origin.defaultCarrier] ??= []).push({ originId: origin.id, originName: origin.name, active: origin.active,
        usesRegionalFee: regional ? Boolean(regional[origin.id]?.managed) : null });
    }
    return uses;
  } catch (error) {
    unstable_rethrow(error);
    return null;
  }
}
