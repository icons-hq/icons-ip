import { describe, expect, it } from 'vitest';
import {
  formatSeowonPhone, matchSeowonReply, seowonExportRows, seowonItemName, SEOWON_REPLY_REASONS,
  type SeowonReplyCandidate, type SeowonReplyRow,
} from './seowon-exchange';

const line = { recipient: '합성 수취인', phone: '01012345678', postalCode: '04524', address: '서울특별시 중구 세종대로 110 101호', deliveryNote: '', goodName: '합성 키링', optionName: '빨강', qty: 2 };
const candidate = (id: string, overrides: Partial<SeowonReplyCandidate> = {}): SeowonReplyCandidate => ({
  id, orderId: `order-${id}`, status: 'ready', trackingNumber: null, lines: [line], ...overrides,
});
const reply = (lineNumber: number, trackingNumber: string, overrides: Partial<SeowonReplyRow> = {}): SeowonReplyRow => ({
  line: lineNumber, phone: '010-1234-5678', address: line.address, items: '합성 키링_빨강', quantity: 2, trackingNumber, ...overrides,
});

describe('서원 송장양식 행 규칙', () => {
  it('전화번호를 원본 표기(하이픈)로 바꾼다', () => {
    expect(['01012345678', '0111234567', '0212345678', '021234567', '0311234567', '07012345678', '050512345678', '15881234', '+82 10']
      .map(formatSeowonPhone)).toEqual(['010-1234-5678', '011-123-4567', '02-1234-5678', '02-123-4567', '031-123-4567', '070-1234-5678', '0505-1234-5678', '1588-1234', '8210']);
  });
  it('품목명은 서원 회신 예시처럼 상품명_옵션명이고 단일 기본 옵션은 상품명만 쓴다', () => {
    expect(seowonItemName(' 리락쿠마 고속충전 미니 보조배터리 10000 ', '리락쿠마 C타입')).toBe('리락쿠마 고속충전 미니 보조배터리 10000_리락쿠마 C타입');
    expect(seowonItemName('합성 엽서', '')).toBe('합성 엽서');
  });
  it('품목 하나가 한 행이고 줄바꿈·연속 공백을 한 칸으로 줄이며 5자리가 아닌 우편번호는 비운다', () => {
    expect(seowonExportRows([{ ...line, address: '서울  중구\n세종대로', deliveryNote: '문 앞\n부탁', postalCode: '123' }, { ...line, optionName: '', qty: 1 }])).toEqual([
      { phone: '010-1234-5678', otherPhone: '', postalCode: '', address: '서울 중구 세종대로', freightType: '', quantity: 2, items: '합성 키링_빨강', recipient: '합성 수취인', deliveryNote: '문 앞 부탁' },
      { phone: '010-1234-5678', otherPhone: '', postalCode: '04524', address: line.address, freightType: '', quantity: 1, items: '합성 키링', recipient: '합성 수취인', deliveryNote: '' },
    ]);
  });
});

describe('서원 회신 대조', () => {
  it('한 배송 건의 여러 줄은 송장 하나로 한 번만 등록하고 줄 내용이 다르면 넘겨짚지 않는다', () => {
    const shipment = candidate('a', { lines: [line, { ...line, goodName: '합성 엽서', optionName: '', qty: 1 }] });
    const match = matchSeowonReply([reply(2, 'T1'), reply(3, 'T1', { items: '합성 엽서', quantity: 1 }), reply(4, 'T2', { quantity: 3 })], [shipment]);
    expect(match.commands).toEqual([{ line: 2, shipmentId: 'a', orderId: 'order-a', trackingNumber: 'T1', lines: [2, 3] }]);
    expect(match.issues).toEqual([{ line: 4, reference: '전화 끝 5678 · 합성 키링_빨강', reason: SEOWON_REPLY_REASONS.notFound }]);
  });
  it('배송 건의 품목 줄이 회신에 하나라도 빠지면 일부 출고일 수 있어 발송처리하지 않는다', () => {
    const shipment = candidate('a', { lines: [line, { ...line, goodName: '합성 엽서', optionName: '', qty: 1 }] });
    const match = matchSeowonReply([reply(2, 'T1')], [shipment]);
    expect(match.commands).toEqual([]);
    expect(match.issues).toEqual([{ line: 2, reference: 'A', reason: SEOWON_REPLY_REASONS.partial }]);
  });
  it('우편번호를 비우거나 공백·하이픈이 달라도 같은 줄로 본다', () => {
    expect(matchSeowonReply([reply(2, 'T1', { phone: '01012345678', address: `  ${line.address.replace(/ /g, '  ')} ` })], [candidate('a')]).commands).toHaveLength(1);
  });
  it('같은 배송 건 줄의 송장번호가 다르거나 다른 줄에 오류가 있으면 그 배송 건 전체를 등록하지 않는다', () => {
    const shipment = candidate('a', { lines: [line, { ...line, goodName: '합성 엽서', optionName: '', qty: 1 }] });
    const split = matchSeowonReply([reply(2, 'T1'), reply(3, 'T2', { items: '합성 엽서', quantity: 1 })], [shipment]);
    expect(split.commands).toEqual([]);
    expect(split.issues.map(issue => [issue.line, issue.reason, issue.reference])).toEqual([[2, SEOWON_REPLY_REASONS.conflictInFile, 'A'], [3, SEOWON_REPLY_REASONS.conflictInFile, 'A']]);
    const broken = matchSeowonReply([reply(2, 'T1'), reply(3, '', { items: '합성 엽서', quantity: 1, error: '송장번호가 비어 있습니다.' })], [shipment]);
    expect(broken.commands).toEqual([]);
    expect(broken.issues.map(issue => [issue.line, issue.reason])).toEqual([[2, SEOWON_REPLY_REASONS.blockedSibling], [3, '송장번호가 비어 있습니다.']]);
  });
  it('받는 분·품목이 같은 발송 대기 건은 서원이 합배송한 경우(송장 하나)만 함께 등록한다', () => {
    const twins = [candidate('a'), candidate('b')];
    expect(matchSeowonReply([reply(2, 'T1'), reply(3, 'T1')], twins).commands.map(command => [command.shipmentId, command.trackingNumber])).toEqual([['a', 'T1'], ['b', 'T1']]);
    const separate = matchSeowonReply([reply(2, 'T1'), reply(3, 'T2')], twins);
    expect(separate.commands).toEqual([]);
    expect(separate.issues.map(issue => issue.reason)).toEqual([SEOWON_REPLY_REASONS.splitIdentical, SEOWON_REPLY_REASONS.splitIdentical]);
  });
  it('같은 회신을 다시 올리면 그대로 두고, 이미 발송된 건의 다른 송장은 덮어쓰지 않는다', () => {
    const shipped = candidate('a', { status: 'shipping', trackingNumber: 'T1' });
    expect(matchSeowonReply([reply(2, 'T1')], [shipped])).toEqual({ commands: [], unchanged: [{ shipmentId: 'a', lines: [2] }], issues: [] });
    expect(matchSeowonReply([reply(2, 'T9')], [shipped]).issues.map(issue => issue.reason)).toEqual([SEOWON_REPLY_REASONS.alreadyShipped]);
  });
  it('예전 회신을 다시 올려도 같은 내용의 새 주문을 옛 송장으로 발송하지 않는다', () => {
    const match = matchSeowonReply([reply(2, 'T1')], [candidate('old', { status: 'delivered', trackingNumber: 'T1' }), candidate('new')]);
    expect(match.commands).toEqual([]);
    expect(match.unchanged).toEqual([{ shipmentId: 'old', lines: [2] }]);
    const fresh = matchSeowonReply([reply(2, 'T2')], [candidate('old', { status: 'delivered', trackingNumber: 'T1' }), candidate('new')]);
    expect(fresh.commands.map(command => command.shipmentId)).toEqual(['new']);
  });
});
