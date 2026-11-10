import { describe, expect, it } from 'vitest';
import { goodsGroupPreviewMatches, goodsGroupRecoveryKey, parseGoodsGroupConversionRequest, parseGoodsGroupPage, parseGoodsGroupPreview, parseGoodsGroupReceipt, parseGoodsGroupRecovery, parseGoodsGroupSnapshot, parseGoodsGroupSource, parseGoodsGroupValues } from './goods-groups';
import { groupTestGroup as group, groupTestId as id, groupTestIdentity as identity, groupTestPreview as preview, groupTestReceipt as receipt, groupTestRecovery as recovery, groupTestRequest as request, groupTestSource as source } from './goods-groups.test-fixtures';

describe('그룹상품 변환 계약', () => {
  it('선택 순서·상품번호 유지·개별 재고가 일치하는 계획만 받는다', () => {
    expect(parseGoodsGroupConversionRequest(request)).toEqual(request); expect(parseGoodsGroupSource(source)).toEqual(source);
    expect(parseGoodsGroupPreview(preview)).toEqual(preview); expect(goodsGroupPreviewMatches(preview, request)).toBe(true);
    expect(goodsGroupPreviewMatches(preview, { ...request, selections: [...request.selections].reverse() })).toBe(false);
    expect(parseGoodsGroupPreview({ ...preview, plan: { ...preview.plan, members: [...preview.plan.members].reverse() } })).toBeNull();
    expect(parseGoodsGroupPreview({ ...preview, plan: { ...preview.plan, aggregationPreserved: false } })).toBeNull();
    expect(parseGoodsGroupPreview({ ...preview, plan: { ...preview.plan, cost: 9000 } })).toBeNull();
  });
  it.each([
    { name: ' '.repeat(4) }, { optionNames: ['색상', '색상'] }, { selections: [request.selections[0]] },
    { selections: [request.selections[0], request.selections[0]] }, { selections: request.selections.map(row => ({ ...row, values: ['같은값'] })) },
    { sourceGoodId: '../bad' }, { includeCosts: true },
  ])('유효하지 않은 변환 입력을 거절한다: %j', patch => expect(parseGoodsGroupConversionRequest({ ...request, ...patch })).toBeNull());
  it('원가·외부코드 등 허용되지 않은 필드를 public plan과 source에서 거절한다', () => {
    expect(parseGoodsGroupSource({ ...source, purchaseCost: 100 })).toBeNull();
    expect(parseGoodsGroupSource({ ...source, variants: [{ ...source.variants[0], erpCode: 'secret' }] })).toBeNull();
    expect(parseGoodsGroupSnapshot({ ...group, members: [{ ...group.members[0], unitCost: 100 }] })).toBeNull();
  });
});
describe('그룹 구성과 보관 결과', () => {
  it('구성 중복·배열 차원·신규 최소 2개를 검증한다', () => {
    const values = { name: group.name, optionNames: group.optionNames, members: group.members.map(row => ({ goodId: row.goodId, values: row.values })) };
    expect(parseGoodsGroupValues(values, 2)).toEqual(values);
    expect(parseGoodsGroupValues({ ...values, members: [values.members[0]] }, 2)).toBeNull();
    expect(parseGoodsGroupValues({ ...values, members: [values.members[0]] }, 1)).not.toBeNull();
    expect(parseGoodsGroupValues({ ...values, members: values.members.map(row => ({ ...row, values: ['빨강'] })) })).toBeNull();
    expect(parseGoodsGroupSnapshot(group)).toEqual(group);
    expect(parseGoodsGroupPage({ rows: [group, group], total: 2, page: 1, pageSize: 30 })).toBeNull();
  });
  it('연결 해제는 빈 멤버 목록을 가진 보관된 그룹으로 읽는다', () => {
    const metadata = { version: 1 as const, ...identity, operationId: id(22), command: 'archive' as const, groupId: group.id, expectedRevision: 1 };
    const archived = { state: 'completed', operationId: metadata.operationId, group: { ...group, revision: 2, archivedAt: '2026-10-14T00:00:00Z', members: [] } };
    expect(parseGoodsGroupReceipt(archived, metadata)).toEqual(archived);
    expect(parseGoodsGroupReceipt({ ...archived, group: { ...group, revision: 2 } }, metadata)).toBeNull();
  });
});
describe('결과 유실 복구의 메타데이터 경계', () => {
  it('현재 계정·세션과 변환 미리보기에 결속하고 입력은 저장하지 않는다', () => {
    expect(parseGoodsGroupRecovery(recovery, identity)).toEqual(recovery);
    expect(parseGoodsGroupRecovery({ ...recovery, values: request }, identity)).toBeNull();
    expect(parseGoodsGroupRecovery(recovery, { ...identity, sessionId: id(99) })).toBeNull();
    expect(goodsGroupRecoveryKey(identity, 'convert')).not.toBe(goodsGroupRecoveryKey({ ...identity, actorId: id(99) }, 'convert'));
    expect(parseGoodsGroupReceipt(receipt, recovery)).toEqual(receipt);
    expect(parseGoodsGroupReceipt({ ...receipt, operationId: id(99) }, recovery)).toBeNull();
    expect(parseGoodsGroupReceipt({ ...receipt, group: { ...group, commonGoodId: 'group-child' } }, recovery)).toBeNull();
  });
  it.each(['create', 'update', 'archive', 'common'] as const)('%s 복구는 그룹·기준버전·명령만 보존한다', command => {
    const metadata = { version: 1 as const, ...identity, operationId: id(22), command, groupId: group.id, expectedRevision: command === 'create' ? 0 : 1 };
    expect(parseGoodsGroupRecovery(metadata, identity)).toEqual(metadata);
    expect(parseGoodsGroupRecovery({ ...metadata, requestHash: 'private' }, identity)).toBeNull();
    expect(parseGoodsGroupReceipt({ state: 'unresolved', operationId: metadata.operationId }, metadata)).toEqual({ state: 'unresolved', operationId: metadata.operationId });
    expect(parseGoodsGroupReceipt({ state: 'sealed', operationId: metadata.operationId }, metadata)).toEqual({ state: 'sealed', operationId: metadata.operationId });
  });
});
