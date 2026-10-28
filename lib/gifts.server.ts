import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { createClient } from './supabase/server';
import { createServiceClient } from './supabase/service';
import { getSupabaseConfig } from './supabase/config';
import { GIFT_CLAIM_COOKIE, GIFT_TOKEN_PATTERN, maskRandomGiftItems, parseGiftDetail, parseGiftInvitation, parseGiftPage, type GiftItem, type GiftParty } from './gifts';

export function giftSecretHash(token: string): string | null {
  if (!GIFT_TOKEN_PATTERN.test(token)) return null;
  const bytes = Buffer.from(token, 'base64url');
  if (bytes.length !== 32 || bytes.toString('base64url') !== token) return null;
  return createHash('sha256').update(token).digest('hex');
}
export async function giftClaimSessionHash(): Promise<string | null> {
  const raw = (await cookies()).get(GIFT_CLAIM_COOKIE)?.value; return raw ? giftSecretHash(raw) : null;
}
export async function beginGiftClaimSession(token: string): Promise<{ secret: string; expiresAt: string } | null> {
  const tokenHash = giftSecretHash(token); if (!tokenHash) return null;
  const secret = randomBytes(32).toString('base64url'), sessionHash = giftSecretHash(secret)!;
  const service = createServiceClient(); const { data, error } = await service.rpc('service_begin_gift_claim_session', { p_token_hash: tokenHash, p_session_hash: sessionHash });
  if (error) throw new Error('gift_claim_session_failed');
  if (data === null) return null;
  if (typeof data !== 'string' || !Number.isFinite(Date.parse(data)) || Date.parse(data) <= Date.now()) throw new Error('gift_claim_session_invalid');
  return { secret, expiresAt: data };
}
export async function giftsAvailable(): Promise<boolean> {
  if (!getSupabaseConfig().isConfigured) return false;
  const client = await createClient(), { data, error } = await client.rpc('get_gift_availability');
  return !error && data === true;
}
type GiftClient = Awaited<ReturnType<typeof createClient>>;
/**
 * 선물 품목의 랜덤 판매 옵션명을 가린다(ADR-0027 · m27 CUST-1). 선물은 만들 때 랜덤 판매 굿즈를 거절하지만, 만든 뒤 판매 방식이
 * 랜덤으로 바뀐 굿즈는 품목 스냅샷에 기본 옵션의 실제 이름이 남는다. 화면·서버 액션 응답에 닿기 전에 '랜덤'으로 바꾼다.
 * 판매 방식을 읽지 못하면 옵션명을 그대로 내보내지 않고 실패한다. 랜덤 판매 굿즈는 많지 않아 공개 카탈로그에서 한 번에 읽는다.
 */
export async function maskRandomGiftOptions<T extends { items: GiftItem[] }>(values: readonly T[], client?: GiftClient): Promise<T[]> {
  if (!values.some(value => value.items.length)) return [...values];
  const { data, error } = await (client ?? await createClient()).from('goods').select('id').eq('option_sale_mode', 'random');
  if (error || !Array.isArray(data)) throw new Error('선물 정보를 확인하지 못했습니다.');
  const random = new Set(data.flatMap(row => typeof row?.id === 'string' ? [row.id] : []));
  return values.map(value => maskRandomGiftItems(value, random));
}
export async function loadGift(id: string) {
  const client = await createClient(), { data, error } = await client.rpc('get_my_gift_numbered', { p_id: id });
  if (error) throw new Error('선물을 불러오지 못했습니다.'); if (data === null) return null;
  const gift = parseGiftDetail(data); if (!gift || gift.id !== id) throw new Error('선물 정보를 확인하지 못했습니다.');
  return (await maskRandomGiftOptions([gift], client))[0];
}
export async function loadGifts(party: GiftParty, cursor?: { createdAt: string; id: string }) {
  const client = await createClient(), { data, error } = await client.rpc('list_my_gifts_numbered', { p_party: party, p_before: cursor?.createdAt ?? null, p_before_id: cursor?.id ?? null });
  const page = parseGiftPage(data); if (error || !page) throw new Error('선물함을 불러오지 못했습니다.');
  return { ...page, items: await maskRandomGiftOptions(page.items, client) };
}
export async function loadGiftInvitation() {
  const sessionHash = await giftClaimSessionHash(); if (!sessionHash) return null;
  const client = await createClient(), { data, error } = await client.rpc('read_my_gift_invitation', { p_session_hash: sessionHash });
  if (error) throw new Error('선물 링크를 확인하지 못했습니다.'); if (data === null) return null;
  const invitation = parseGiftInvitation(data); if (!invitation) throw new Error('선물 정보를 확인하지 못했습니다.');
  return (await maskRandomGiftOptions([invitation], client))[0];
}
