import 'server-only';
import { unstable_rethrow } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { fulfillmentOriginTabHref } from './fulfillment-origin-tabs';
import { FULFILLMENT_ORIGINS_PATH } from './fulfillment-origins';
import { loadAdminFulfillmentOrigins } from './fulfillment-origins.server';
import { loadCarrierOriginUses } from './shipping-impact.server';
import { CARRIER_TURN_OFF_UNKNOWN, carrierInUseMessage, carrierTurnOff, type CarrierUsesByCode } from './store-settings';

/*
 * 택배사를 끄기 전에 알릴 것: 그 택배사를 기본 택배사로 쓰는 출고지. 읽기만 한다 — 저장·상태 변경은 하지 않는다.
 * 출고지 목록을 읽지 못하면 null이다. 쓰는 출고지가 없다는 뜻이 아니므로 화면도 서버 액션도 끌 수 있다고 하지 않는다.
 * 권한은 부르는 쪽이 먼저 확인한다(화면: `requireAdminScreenAccess`, 서버 액션: `requireAdminActionAccess`).
 */

/** 택배사 관리 화면용. 택배사 코드마다 그 택배사를 쓰는 출고지(이름·사용 여부·그 출고지 탭 링크). 읽지 못하면 null. */
export async function loadCarrierUsesView(): Promise<CarrierUsesByCode> {
  const uses = await loadCarrierOriginUses();
  if (!uses) return null;
  /* 링크는 출고지 탭 주소(?origin=<출고지 코드>)다. 코드를 읽지 못해도 화면은 열리고, 그때는 배송정보 관리 첫 화면으로 보낸다. */
  const codes = new Map<string, string>();
  try {
    for (const origin of await loadAdminFulfillmentOrigins()) codes.set(origin.id, origin.code);
  } catch (error) {
    unstable_rethrow(error);
  }
  return Object.fromEntries(Object.entries(uses).map(([carrier, rows]) => [carrier, rows.map(row => {
    const code = codes.get(row.originId);
    return { name: row.originName, active: row.active, href: code ? fulfillmentOriginTabHref(code) : FULFILLMENT_ORIGINS_PATH };
  })]));
}

/** 이 택배사가 지금 사용 안 함인가. 읽지 못하면 false(모른다 — 호출한 쪽이 사용 중으로 보고 판정한다). */
async function isCarrierOff(code: string): Promise<boolean> {
  try {
    const { data, error } = await (await createClient()).from('shipping_carriers').select('is_active').eq('code', code).maybeSingle();
    return !error && data?.is_active === false;
  } catch (error) {
    unstable_rethrow(error);
    return false;
  }
}

/**
 * 택배사를 '사용 안 함'으로 저장하기 전의 판정(서버 액션). 막아야 하면 운영자에게 보일 문구를, 끌 수 있으면 null을 돌려준다.
 * 이미 사용 안 함인 택배사의 이름·주소만 고치는 저장은 새로 끄는 일이 아니라 막지 않는다. 쓰는 출고지를 읽지 못했으면 막는다.
 */
export async function carrierTurnOffBlock(code: string): Promise<string | null> {
  if (await isCarrierOff(code)) return null;
  const uses = await loadCarrierOriginUses();
  const verdict = carrierTurnOff(uses ? (uses[code] ?? []).map(use => ({ name: use.originName, active: use.active })) : null);
  if (verdict.ok) return null;
  return verdict.reason === 'unknown' ? CARRIER_TURN_OFF_UNKNOWN : carrierInUseMessage(verdict.active.map(use => use.name));
}
