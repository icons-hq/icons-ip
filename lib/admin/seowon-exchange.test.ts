import { describe, expect, it } from 'vitest';
import {
  formatSeowonPhone, matchSeowonReply, seowonExportLabels, seowonExportRows, seowonExportTable, seowonItemName, seowonRowKey, SEOWON_REPLY_REASONS,
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
  it('품목명은 서원 회신 예시처럼 상품명_옵션명이고 옵션이 없으면 원본처럼 상품명_으로 끝난다', () => {
    expect(seowonItemName(' 리락쿠마 고속충전 미니 보조배터리 10000 ', '리락쿠마 C타입')).toBe('리락쿠마 고속충전 미니 보조배터리 10000_리락쿠마 C타입');
    expect(seowonItemName('합성 엽서', '')).toBe('합성 엽서_');
  });
  it('품목 하나가 한 행이고 줄바꿈·연속 공백을 한 칸으로 줄이며 5자리가 아닌 우편번호는 비운다', () => {
    expect(seowonExportRows([{ ...line, address: '서울  중구\n세종대로', deliveryNote: '문 앞\n부탁', postalCode: '123' }, { ...line, optionName: '', qty: 1 }])).toEqual([
      { phone: '010-1234-5678', otherPhone: '', postalCode: '', address: '서울 중구 세종대로', freightType: '', quantity: 2, items: '합성 키링_빨강', recipient: '합성 수취인', deliveryNote: '문 앞 부탁', shipmentNumber: '', optionName: '빨강', barcode: '', erpName: '' },
      { phone: '010-1234-5678', otherPhone: '', postalCode: '04524', address: line.address, freightType: '', quantity: 1, items: '합성 키링_', recipient: '합성 수취인', deliveryNote: '', shipmentNumber: '', optionName: '', barcode: '', erpName: '' },
    ]);
  });
  it('덧붙인 옵션명·바코드·ERP 품명 열은 품목명과 회신 대조 키를 바꾸지 않는다', () => {
    const [plain] = seowonExportRows([line]);
    const [identified] = seowonExportRows([{ ...line, optionName: ' 빨강  ', barcode: '0880123456789', erpName: ' 합성 키링 빨강(ERP) ' }]);
    expect([identified.optionName, identified.barcode, identified.erpName]).toEqual(['빨강', '0880123456789', '합성 키링 빨강(ERP)']);
    expect(identified.items).toBe(plain.items);
    expect(seowonRowKey(identified)).toBe(seowonRowKey(plain));
  });
});

describe('서원 합배송 방지 접미사와 배송건번호 열', () => {
  const shipment = (id: string, shipmentNumber: string, overrides: Partial<Parameters<typeof seowonExportTable>[0][number]> = {}) => ({ id, shipmentNumber, lines: [line], ...overrides });
  it('받는 분 이름+전화가 같은 서로 다른 배송 건에 배송건번호 순서로 01·02를 붙이고 행마다 배송건번호를 싣는다', () => {
    const rows = seowonExportTable([shipment('b', '2026102730000002'), shipment('a', '2026102730000001'), shipment('c', '2026102730000003', { lines: [{ ...line, recipient: '다른 분' }] })]);
    expect(rows.map(row => [row.recipient, row.shipmentNumber])).toEqual([['합성 수취인02', '2026102730000002'], ['합성 수취인01', '2026102730000001'], ['다른 분', '2026102730000003']]);
  });
  it('주소가 달라도 이름+전화가 같으면 접미사를 붙이고, 공백 차이는 같은 이름으로 본다', () => {
    const rows = seowonExportTable([shipment('a', '2026102730000001'), shipment('b', '2026102730000002', { lines: [{ ...line, recipient: '합성  수취인', address: '부산 해운대구 1' }] })]);
    expect(rows.map(row => row.recipient)).toEqual(['합성 수취인01', '합성 수취인02']);
  });
  it('운영자가 묶은 합포장은 한 상자라 구성 배송 건 모두 같은 접미사를 쓰고, 혼자인 받는 분은 접미사가 없다', () => {
    const rows = seowonExportTable([shipment('a', '2026102730000003', { packId: 'p' }), shipment('b', '2026102730000001', { packId: 'p' }), shipment('c', '2026102730000002')]);
    expect(rows.map(row => row.recipient)).toEqual(['합성 수취인01', '합성 수취인01', '합성 수취인02']);
    expect(seowonExportTable([shipment('a', '2026102730000001', { packId: 'p' }), shipment('b', '2026102730000002', { packId: 'p' })]).map(row => row.recipient)).toEqual(['합성 수취인', '합성 수취인']);
  });
  it('접미사 기록은 출고지별 파일마다 정하고 서원 양식 출고지만 남긴다', () => {
    const at = (id: string, number: string, originId: string, template = 'seowon_xlsx') => ({ ...shipment(id, number), originId, template });
    expect(seowonExportLabels([at('a', '2026102730000001', 'n1'), at('b', '2026102730000002', 'n1'), at('c', '2026102730000003', 'n2'), at('g', '2026102730000004', 'gimpo', 'wms_csv')]))
      .toEqual([{ shipmentId: 'a', suffix: '01' }, { shipmentId: 'b', suffix: '02' }, { shipmentId: 'c', suffix: '' }]);
  });
});

describe('서원 회신 대조', () => {
  it('한 배송 건의 여러 줄은 송장 하나로 한 번만 등록하고 줄 내용이 다르면 넘겨짚지 않는다', () => {
    const shipment = candidate('a', { lines: [line, { ...line, goodName: '합성 엽서', optionName: '', qty: 1 }] });
    const match = matchSeowonReply([reply(2, 'T1'), reply(3, 'T1', { items: '합성 엽서_', quantity: 1 }), reply(4, 'T2', { quantity: 3 })], [shipment]);
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
    const split = matchSeowonReply([reply(2, 'T1'), reply(3, 'T2', { items: '합성 엽서_', quantity: 1 })], [shipment]);
    expect(split.commands).toEqual([]);
    expect(split.issues.map(issue => [issue.line, issue.reason, issue.reference])).toEqual([[2, SEOWON_REPLY_REASONS.conflictInFile, 'A'], [3, SEOWON_REPLY_REASONS.conflictInFile, 'A']]);
    const broken = matchSeowonReply([reply(2, 'T1'), reply(3, '', { items: '합성 엽서_', quantity: 1, error: '송장번호가 비어 있습니다.' })], [shipment]);
    expect(broken.commands).toEqual([]);
    expect(broken.issues.map(issue => [issue.line, issue.reason])).toEqual([[2, SEOWON_REPLY_REASONS.blockedSibling], [3, '송장번호가 비어 있습니다.']]);
  });
  it('받는 분·품목이 같은 발송 대기 건은 그 줄이 회신에 모두 있고 송장이 하나(합배송)일 때만 함께 등록한다', () => {
    const twins = [candidate('a'), candidate('b')];
    expect(matchSeowonReply([reply(2, 'T1'), reply(3, 'T1')], twins).commands.map(command => [command.shipmentId, command.trackingNumber])).toEqual([['a', 'T1'], ['b', 'T1']]);
    const separate = matchSeowonReply([reply(2, 'T1'), reply(3, 'T2')], twins);
    expect(separate.commands).toEqual([]);
    expect(separate.issues.map(issue => issue.reason)).toEqual([SEOWON_REPLY_REASONS.splitIdentical, SEOWON_REPLY_REASONS.splitIdentical]);
    // 한 건의 줄만 회신됐으면 어느 배송 건인지 모르므로 둘 다 발송하지 않는다.
    const single = matchSeowonReply([reply(2, 'T1')], twins);
    expect(single.commands).toEqual([]);
    expect(single.issues.map(issue => issue.reason)).toEqual([SEOWON_REPLY_REASONS.splitIdentical]);
  });
  it('받는 분·품목이 같아도 서원이 송장을 따로 냈으면 내보낼 때 기록한 접미사와 정확히 맞춰 등록한다', () => {
    const label = (suffix: string, batch = 'batch-1') => ({ batch, suffix });
    const twins = [candidate('b', { shipmentNumber: '2026102730000002', seowonLabel: label('02') }), candidate('a', { shipmentNumber: '2026102730000001', seowonLabel: label('01') })];
    const match = matchSeowonReply([reply(2, 'T2', { recipient: '합성 수취인02' }), reply(3, 'T1', { recipient: '합성 수취인01' })], twins);
    expect(match.issues).toEqual([]);
    expect(match.commands.map(command => [command.shipmentId, command.shipmentNumber, command.trackingNumber, command.lines])).toEqual([['b', '2026102730000002', 'T2', [2]], ['a', '2026102730000001', 'T1', [3]]]);
    // 기록이 없으면(이 변경 전 내보내기) 순위로 추정하지 않고 사람에게 넘긴다.
    const unlabeled = [candidate('b', { shipmentNumber: '2026102730000002' }), candidate('a', { shipmentNumber: '2026102730000001' })];
    const guessed = matchSeowonReply([reply(2, 'T2', { recipient: '합성 수취인02' }), reply(3, 'T1', { recipient: '합성 수취인01' })], unlabeled);
    expect(guessed.commands).toEqual([]);
    expect(guessed.issues.map(issue => issue.reason)).toEqual([SEOWON_REPLY_REASONS.splitIdentical, SEOWON_REPLY_REASONS.splitIdentical]);
    // 접미사가 없거나 서로 다른 내보내기의 같은 접미사면 넘겨짚지 않는다.
    expect(matchSeowonReply([reply(2, 'T2', { recipient: '합성 수취인' }), reply(3, 'T1', { recipient: '합성 수취인' })], twins).commands).toEqual([]);
    const otherBatch = [candidate('b', { seowonLabel: label('01', 'batch-2') }), candidate('a', { seowonLabel: label('01') })];
    expect(matchSeowonReply([reply(2, 'T2', { recipient: '합성 수취인01' }), reply(3, 'T1', { recipient: '합성 수취인02' })], otherBatch).commands).toEqual([]);
  });
  it('내보낸 뒤 한 건이 취소되고 같은 내용의 새 건이 다른 파일로 나가도, 회신 줄을 남은 순위로 새 건에 붙이지 않는다', () => {
    // 파일 1: A01·B02(A는 취소됨), 파일 2: C(혼자라 접미사 없음).
    const b = candidate('b', { shipmentNumber: '2026102730000002', seowonLabel: { batch: 'file-1', suffix: '02' } });
    const c = candidate('c', { shipmentNumber: '2026102730000003', seowonLabel: { batch: 'file-2', suffix: '' } });
    const match = matchSeowonReply([reply(2, 'T1', { recipient: '합성 수취인01' }), reply(3, 'T2', { recipient: '합성 수취인02' })], [b, c]);
    expect(match.commands.map(command => [command.shipmentId, command.trackingNumber])).toEqual([['b', 'T2']]);
    expect(match.issues).toEqual([{ line: 2, reference: '전화 끝 5678 · 합성 키링_빨강', reason: SEOWON_REPLY_REASONS.splitIdentical }]);
    // 같은 내용의 발송 대기 건이 하나뿐이어도 접미사가 기록과 다르면 그 줄은 다른 배송 건의 것이다.
    const alone = matchSeowonReply([reply(2, 'T1', { recipient: '합성 수취인01' }), reply(3, 'T2', { recipient: '합성 수취인02' })], [b]);
    expect(alone.commands.map(command => [command.shipmentId, command.trackingNumber])).toEqual([['b', 'T2']]);
    expect(alone.issues.map(issue => [issue.line, issue.reason])).toEqual([[2, SEOWON_REPLY_REASONS.suffixMismatch]]);
  });
  it('합포장 구성원과 다른 배송 건이 같은 내용이어도 기록한 접미사로 가르고, 합포장이 다 모이지 않으면 그 묶음만 멈춘다', () => {
    const pack = { id: 'pack-1', shipmentIds: ['a', 'd'] };
    const a = candidate('a', { shipmentNumber: '2026102730000001', pack, seowonLabel: { batch: 'f', suffix: '01' }, lines: [{ ...line, goodName: '합성 엽서', optionName: '', qty: 1 }] });
    const d = candidate('d', { shipmentNumber: '2026102730000004', pack, seowonLabel: { batch: 'f', suffix: '01' } });
    const b = candidate('b', { shipmentNumber: '2026102730000002', seowonLabel: { batch: 'f', suffix: '02' } });
    const rows = [reply(2, 'T1', { recipient: '합성 수취인01', items: '합성 엽서_', quantity: 1 }), reply(3, 'T2', { recipient: '합성 수취인02' }), reply(4, 'T1', { recipient: '합성 수취인01' })];
    const match = matchSeowonReply(rows, [a, b, d]);
    expect(match.issues).toEqual([]);
    expect(match.commands.map(command => [command.shipmentId, command.trackingNumber])).toEqual([['a', 'T1'], ['b', 'T2'], ['d', 'T1']]);
    // 합포장의 한 줄이 빠지면 그 합포장만 멈추고 다른 배송 건은 등록한다.
    const partial = matchSeowonReply(rows.filter(row => row.line !== 4), [a, b, d]);
    expect(partial.commands.map(command => command.shipmentId)).toEqual(['b']);
    expect(partial.issues).toEqual([{ line: 2, reference: '2026102730000001', reason: SEOWON_REPLY_REASONS.packIncomplete }]);
    // 접미사 기록이 없으면(이 기록 도입 전 내보내기) 같은 내용 줄은 사람에게 넘기고, 그 때문에 덜 모인 합포장도 멈춘다.
    const unlabeled = [a, b, d].map(entry => ({ ...entry, seowonLabel: null }));
    const guessed = matchSeowonReply(rows, unlabeled);
    expect(guessed.commands).toEqual([]);
    expect(guessed.issues.map(issue => [issue.line, issue.reason])).toEqual([[2, SEOWON_REPLY_REASONS.packIncomplete], [3, SEOWON_REPLY_REASONS.splitIdentical], [4, SEOWON_REPLY_REASONS.splitIdentical]]);
    // 합포장 구성원의 송장이 갈려도 그 합포장만 멈춘다.
    const split = matchSeowonReply([rows[0], rows[1], { ...rows[2], trackingNumber: 'T9' }], [a, b, d]);
    expect(split.commands.map(command => command.shipmentId)).toEqual(['b']);
    expect(split.issues.map(issue => [issue.line, issue.reason])).toEqual([[2, SEOWON_REPLY_REASONS.packIncomplete], [4, SEOWON_REPLY_REASONS.packIncomplete]]);
  });
  it('송장 하나로 함께 온 같은 내용의 줄은 기록된 접미사와 맞을 때만 함께 등록한다', () => {
    const twins = [candidate('a', { seowonLabel: { batch: 'f', suffix: '01' } }), candidate('c', { seowonLabel: { batch: 'g', suffix: '' } })];
    // 파일 1의 A01·B02(B는 취소)가 한 송장으로 왔다 — A만 등록하고 B02 줄을 다른 파일의 C에 붙이지 않는다.
    const merged = matchSeowonReply([reply(2, 'T1', { recipient: '합성 수취인01' }), reply(3, 'T1', { recipient: '합성 수취인02' })], twins);
    expect(merged.commands.map(command => [command.shipmentId, command.trackingNumber])).toEqual([['a', 'T1']]);
    expect(merged.issues.map(issue => [issue.line, issue.reason])).toEqual([[3, SEOWON_REPLY_REASONS.splitIdentical]]);
    // 기록과 맞으면 종전처럼 함께 등록한다.
    const agreed = matchSeowonReply([reply(2, 'T1', { recipient: '합성 수취인01' }), reply(3, 'T1', { recipient: '합성 수취인' })], twins);
    expect(agreed.commands.map(command => [command.shipmentId, command.trackingNumber])).toEqual([['a', 'T1'], ['c', 'T1']]);
  });
  it('회신에 배송건번호가 남아 있으면 그 배송 건만 보고, 줄 내용이 다르거나 없는 번호면 등록하지 않는다', () => {
    const twins = [candidate('a', { shipmentNumber: '2026102730000001' }), candidate('b', { shipmentNumber: '2026102730000002' })];
    const exact = matchSeowonReply([reply(2, 'T1', { shipmentNumber: '2026102730000002' })], twins);
    expect(exact.commands.map(command => [command.shipmentId, command.trackingNumber])).toEqual([['b', 'T1']]);
    const mismatch = matchSeowonReply([reply(2, 'T1', { shipmentNumber: '2026102730000002', quantity: 9 })], twins);
    expect(mismatch.issues).toEqual([{ line: 2, reference: '2026102730000002', reason: SEOWON_REPLY_REASONS.numberMismatch }]);
    const unknown = matchSeowonReply([reply(2, 'T1', { shipmentNumber: '2026102730000009' })], twins);
    expect(unknown.issues).toEqual([{ line: 2, reference: '2026102730000009', reason: SEOWON_REPLY_REASONS.notFound }]);
    const shipped = matchSeowonReply([reply(2, 'T1', { shipmentNumber: '2026102730000001' }), reply(3, 'T9', { shipmentNumber: '2026102730000002' })],
      [candidate('a', { shipmentNumber: '2026102730000001', status: 'shipping', trackingNumber: 'T1' }), candidate('b', { shipmentNumber: '2026102730000002', status: 'delivered', trackingNumber: 'T2' })]);
    expect(shipped.unchanged).toEqual([{ shipmentId: 'a', lines: [2] }]);
    expect(shipped.issues).toEqual([{ line: 3, reference: '2026102730000002', reason: SEOWON_REPLY_REASONS.alreadyShipped }]);
  });
  it('실패 사유의 배송 건은 16자리 배송건번호로 적는다', () => {
    const shipment = candidate('a', { shipmentNumber: '2026102730000001', lines: [line, { ...line, goodName: '합성 엽서', optionName: '', qty: 1 }] });
    expect(matchSeowonReply([reply(2, 'T1')], [shipment]).issues).toEqual([{ line: 2, reference: '2026102730000001', reason: SEOWON_REPLY_REASONS.partial }]);
  });
  it('합배송한 두 배송 건에 다른 품목이 더 있어도 각 배송 건의 줄이 모두 있으면 함께 등록한다', () => {
    const bigger = candidate('a', { lines: [line, { ...line, goodName: '합성 엽서', optionName: '', qty: 1 }] });
    const match = matchSeowonReply([reply(2, 'T1'), reply(3, 'T1', { items: '합성 엽서_', quantity: 1 }), reply(4, 'T1')], [bigger, candidate('b')]);
    expect(match.issues).toEqual([]);
    expect(match.commands.map(command => [command.shipmentId, command.lines])).toEqual([['a', [2, 3, 4]], ['b', [2, 4]]]);
  });
  it('같은 내용의 품목 줄이 둘인 배송 건은 회신에도 두 줄이 있어야 발송처리한다', () => {
    const doubled = candidate('a', { lines: [line, { ...line }] });
    expect(matchSeowonReply([reply(2, 'T1')], [doubled]).issues.map(issue => issue.reason)).toEqual([SEOWON_REPLY_REASONS.partial]);
    expect(matchSeowonReply([reply(2, 'T1'), reply(3, 'T1')], [doubled]).commands.map(command => command.lines)).toEqual([[2, 3]]);
  });
  it('받는 분이 다른 배송 건에 같은 새 송장번호가 적혀 있으면 모두 등록하지 않는다', () => {
    const other = candidate('b', { lines: [{ ...line, phone: '01099998888', address: '부산광역시 해운대구 1' }] });
    const match = matchSeowonReply([reply(2, 'T1'), reply(3, 'T1', { phone: '010-9999-8888', address: '부산광역시 해운대구 1' })], [candidate('a'), other]);
    expect(match.commands).toEqual([]);
    expect(match.issues.map(issue => [issue.line, issue.reason])).toEqual([[2, SEOWON_REPLY_REASONS.trackingSharedAcrossRecipients], [3, SEOWON_REPLY_REASONS.trackingSharedAcrossRecipients]]);
  });
  it('기간과 관계없이 이미 다른 배송 건에 쓰인 송장번호는 새 배송 건에 붙이지 않는다', () => {
    const match = matchSeowonReply([reply(2, 'T1')], [candidate('new')], [{ trackingNumber: 'T1', shipmentId: 'old' }]);
    expect(match.commands).toEqual([]);
    expect(match.issues).toEqual([{ line: 2, reference: 'NEW', reason: SEOWON_REPLY_REASONS.trackingInUse }]);
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
