import { describe, expect, it } from 'vitest';
import {
  IP_DELETE_REFERENCE_KEYS,
  ipDeleteBlockers,
  ipDraftDeleteErrorMessage,
  parseIpDeleteReadiness,
} from './ip-delete';

const zero = Object.fromEntries(IP_DELETE_REFERENCE_KEYS.map((key) => [key, 0]));
const raw = {
  id: 'hwasan', title: '화산강림', publicSlug: 'hwasan', state: 'draft', publicHistory: false,
  aliases: [], references: zero, referenceTotal: 0, deletable: true,
};

describe('IP draft deletion readiness', () => {
  it('reads the DB judgement strictly', () => {
    expect(parseIpDeleteReadiness(raw)).toEqual({ ...raw, references: zero });
    /* PostgREST may serialise bigint counts as strings. */
    expect(parseIpDeleteReadiness({ ...raw, references: { ...zero, goods: '2' }, referenceTotal: '2' })?.references.goods).toBe(2);
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a missing reference kind', { ...raw, references: { goods: 0 } }],
    ['a negative count', { ...raw, references: { ...zero, posts: -1 } }],
    ['an unknown state', { ...raw, state: 'deleted' }],
    ['a non-boolean decision', { ...raw, deletable: 'true' }],
    ['malformed aliases', { ...raw, aliases: [1] }],
  ])('refuses %s so the screen never opens deletion without evidence', (_label, value) => {
    expect(parseIpDeleteReadiness(value)).toBeNull();
  });

  it('has no blocker for an unused draft', () => {
    expect(ipDeleteBlockers(parseIpDeleteReadiness(raw)!)).toEqual([]);
  });

  it('names every linked kind with its count and the public history', () => {
    const readiness = parseIpDeleteReadiness({
      ...raw, publicHistory: true, references: { ...zero, goods: 2, coupons: 1 }, referenceTotal: 3, deletable: false,
    })!;
    expect(ipDeleteBlockers(readiness)).toEqual([
      '공개된 적이 있는 IP는 삭제할 수 없습니다. 더 쓰지 않으면 보관해주세요.',
      '연결된 항목이 있어 삭제할 수 없습니다: 상품 2건 · 쿠폰 1건. 연결을 먼저 정리하거나 보관해주세요.',
    ]);
  });

  it('explains why published and archived IPs are not deletable', () => {
    expect(ipDeleteBlockers(parseIpDeleteReadiness({ ...raw, state: 'published', deletable: false })!))
      .toEqual(['공개 중인 IP입니다. 초안만 삭제할 수 있습니다.']);
    expect(ipDeleteBlockers(parseIpDeleteReadiness({ ...raw, state: 'archived', deletable: false })!)[0])
      .toContain('먼저 복원해 초안으로 되돌린 뒤 삭제할 수 있습니다.');
  });

  it.each([
    [{ message: 'ip_has_references' }, '그사이 연결된 항목이 생겨 삭제하지 않았습니다. 새로고침해 연결을 확인해주세요.'],
    [{ message: 'ip_has_public_history' }, '공개된 적이 있는 IP는 삭제할 수 없습니다. 더 쓰지 않으면 보관해주세요.'],
    [{ message: 'ip_not_draft' }, '초안 상태의 IP만 삭제할 수 있습니다. 새로고침해 게시 상태를 확인해주세요.'],
    [{ message: 'catalog_not_found' }, 'IP를 찾을 수 없습니다. IP 목록을 새로고침해주세요.'],
    [{ code: '42501', message: 'operator_capability_required' }, '미사용 IP 삭제는 통합 매니저·계정 주매니저(권한 전환 전에는 기존 관리자)만 할 수 있습니다.'],
    [{ message: 'private provider detail' }, 'IP를 삭제하지 못했습니다. 잠시 후 다시 시도해주세요.'],
  ])('maps the delete rejection %j to operator language', (error, message) => {
    expect(ipDraftDeleteErrorMessage(error)).toBe(message);
  });
});
