import type { ShipmentExportLine } from './shipment-workbook';

/**
 * 서원(남양주) 송장양식 교환 규칙. 내보내기와 회신 대조가 같은 행 규칙을 써야
 * 회신이 배송 건으로 돌아온다 — 서원은 주문번호를 돌려주지 않는다(질문지 D4).
 */
export type SeowonLine = Pick<ShipmentExportLine, 'recipient' | 'phone' | 'postalCode' | 'address' | 'goodName' | 'optionName' | 'qty' | 'deliveryNote'>;
export interface SeowonExportRow {
  phone: string; otherPhone: ''; postalCode: string; address: string; freightType: '';
  quantity: number; items: string; recipient: string; deliveryNote: string;
}

const squash = (value: string) => value.normalize('NFC').replace(/\s+/g, ' ').trim();
const digits = (value: string) => value.replace(/\D/g, '');

/** 원본 송장양식의 전화번호 표기(010-1234-5678). 주문에는 숫자만 저장된다. */
export function formatSeowonPhone(value: string): string {
  const number = digits(value);
  if (number.length === 12 && number.startsWith('050')) return `${number.slice(0, 4)}-${number.slice(4, 8)}-${number.slice(8)}`;
  if (number.startsWith('02') && (number.length === 9 || number.length === 10)) return `02-${number.slice(2, -4)}-${number.slice(-4)}`;
  if (number.startsWith('0') && (number.length === 10 || number.length === 11)) return `${number.slice(0, 3)}-${number.slice(3, -4)}-${number.slice(-4)}`;
  if (number.length === 8 && /^1[5-9]/.test(number)) return `${number.slice(0, 4)}-${number.slice(4)}`;
  return number;
}

/**
 * 서원이 상품을 찾는 이름(B2 회신 예: `상품명_옵션명`). 옵션이 없는 단일 상품도 제공 원본의
 * 같은 형식 행처럼 `상품명_`으로 끝난다.
 */
export function seowonItemName(goodName: string, optionName: string): string {
  return `${squash(goodName)}_${squash(optionName)}`;
}

/** 원본처럼 품목 하나가 한 행이다. 같은 받는 분의 행은 서원 프로그램이 합배송한다(C8). */
export function seowonExportRows(lines: readonly SeowonLine[]): SeowonExportRow[] {
  return lines.map(line => ({
    phone: formatSeowonPhone(line.phone), otherPhone: '', postalCode: /^\d{5}$/.test(line.postalCode) ? line.postalCode : '',
    address: squash(line.address), freightType: '', quantity: line.qty, items: seowonItemName(line.goodName, line.optionName),
    recipient: squash(line.recipient), deliveryNote: squash(line.deliveryNote),
  }));
}

type RowIdentity = { phone: string; address: string; items: string; quantity: number | null };
/** 회신 줄을 배송 건에 잇는 열쇠. 우편번호는 원본 회신처럼 비어 올 수 있어 넣지 않는다. */
export const seowonRowKey = (row: RowIdentity) => [digits(row.phone), squash(row.address), squash(row.items), String(row.quantity ?? '')].join('\u001f');

export interface SeowonReplyRow extends RowIdentity { line: number; trackingNumber: string; error?: string }
export interface SeowonReplyCandidate {
  id: string; orderId: string; status: 'ready' | 'shipping' | 'delivered';
  trackingNumber: string | null; lines: SeowonLine[];
}
export interface SeowonReplyMatch {
  /** 발송처리할 배송 건마다 하나. `line`은 그 배송 건의 첫 회신 줄이다. */
  commands: { line: number; shipmentId: string; orderId: string; trackingNumber: string; lines: number[] }[];
  /** 같은 송장번호로 이미 발송된 배송 건(같은 회신을 다시 올린 경우). 아무것도 바꾸지 않는다. */
  unchanged: { shipmentId: string; lines: number[] }[];
  issues: { line: number; reference: string; reason: string }[];
}

export const SEOWON_REPLY_REASONS = {
  notFound: '출고지시 파일과 일치하는 발송 대기 배송 건이 없습니다. 내려받은 파일의 전화번호·주소·품목명·수량은 그대로 두고 송장번호만 채워주세요.',
  splitIdentical: '받는 분과 품목이 같은 배송 건이 여러 개라 회신 줄만으로 나눌 수 없습니다. 주문 통합검색에서 배송 건별로 등록해주세요.',
  conflictInFile: '같은 배송 건의 줄에 서로 다른 송장번호가 있습니다. 나눠 보낸 경우 대표 송장번호 하나로 맞춰 다시 올려주세요.',
  blockedSibling: '같은 배송 건의 다른 줄에 오류가 있습니다. 해당 배송 건의 모든 줄을 함께 고쳐주세요.',
  partial: '이 배송 건의 품목 가운데 회신에 없는 줄이 있습니다. 모두 출고했다면 내려받은 줄을 빠짐없이 올리고, 일부만 출고했다면 주문 통합검색에서 처리해주세요.',
  alreadyShipped: '이미 다른 운송장으로 발송된 배송 건입니다. 회신 파일로 덮어쓰지 않습니다. 정정은 주문 통합검색의 운송장 수정에서 해주세요.',
  trackingInUse: '이미 다른 배송 건에 등록된 송장번호입니다. 예전 회신을 다시 올린 것은 아닌지 확인해주세요. 정정은 주문 통합검색의 운송장 수정에서 해주세요.',
  trackingSharedAcrossRecipients: '받는 분이 다른 배송 건에 같은 송장번호가 적혀 있습니다. 회신 파일의 송장번호를 확인해주세요.',
} as const;

const label = (row: RowIdentity) => `전화 끝 ${digits(row.phone).slice(-4) || '없음'} · ${squash(row.items).slice(0, 40) || '품목명 없음'}`;
const recipientKey = (line: Pick<SeowonLine, 'phone' | 'address'>) => `${digits(line.phone)}\u001f${squash(line.address)}`;
function countKeys(rows: readonly RowIdentity[]) {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(seowonRowKey(row), (counts.get(seowonRowKey(row)) ?? 0) + 1);
  return counts;
}
const shortId = (id: string) => id.slice(-8).toUpperCase();
function add(map: Map<string, Set<string>>, key: string, id: string) { map.set(key, (map.get(key) ?? new Set()).add(id)); }

/**
 * 회신 줄을 배송 건으로 잇는다. 후보는 출고지시를 전달한 발송 대기 건과 최근 발송 건이다. 줄 내용
 * (전화·주소·품목명·수량)이 같은 배송 건만 인정하고 받는 분만 같은 건으로 넘겨짚지 않는다. 먼저 같은
 * 송장으로 이미 발송된 건인지(같은 회신을 다시 올림) 보고, 그다음 발송 대기 건을 찾는다. 같은 내용의
 * 발송 대기 건이 여럿이면 그 줄이 회신에 모두 있고 송장이 하나일 때(서원 합배송)만 함께 등록한다.
 * `usedTracking`은 기간과 관계없이 이미 다른 배송 건에 쓰인 송장번호다 — 예전 회신을 다시 올려도
 * 같은 내용의 새 주문이 옛 송장으로 발송되지 않는다.
 */
export function matchSeowonReply(
  rows: readonly SeowonReplyRow[], candidates: readonly SeowonReplyCandidate[],
  usedTracking: readonly { trackingNumber: string; shipmentId: string }[] = [],
): SeowonReplyMatch {
  const byId = new Map(candidates.map(candidate => [candidate.id, candidate]));
  const ready = new Map<string, Set<string>>(), shipped = new Map<string, Set<string>>();
  for (const candidate of candidates) for (const row of seowonExportRows(candidate.lines))
    add(candidate.status === 'ready' ? ready : shipped, seowonRowKey(row), candidate.id);
  const issues = new Map<string, SeowonReplyMatch['issues'][number]>();
  const issue = (row: SeowonReplyRow, reason: string, reference = label(row)) => issues.set(`${row.line}:${reason}`, { line: row.line, reference, reason });
  const assigned = new Map<string, SeowonReplyRow[]>(), shared = new Map<string, { ids: string[]; rows: SeowonReplyRow[] }>();
  const resent = new Map<string, number[]>();
  const assign = (id: string, row: SeowonReplyRow) => assigned.set(id, [...(assigned.get(id) ?? []), row]);
  for (const row of rows) {
    const key = seowonRowKey(row), shippedIds = [...(shipped.get(key) ?? [])];
    const sameWaybill = row.error ? [] : shippedIds.filter(id => byId.get(id)!.trackingNumber === row.trackingNumber);
    if (sameWaybill.length) { for (const id of sameWaybill) resent.set(id, [...(resent.get(id) ?? []), row.line]); continue; }
    const readyIds = [...(ready.get(key) ?? [])].sort();
    if (readyIds.length === 1) assign(readyIds[0], row);
    else if (readyIds.length) {
      const group = `${readyIds.join(',')}\u001e${key}`;
      shared.set(group, { ids: readyIds, rows: [...(shared.get(group)?.rows ?? []), row] });
    }
    else issue(row, row.error ?? (shippedIds.length ? SEOWON_REPLY_REASONS.alreadyShipped : SEOWON_REPLY_REASONS.notFound));
  }
  for (const group of shared.values()) {
    // 내려받은 같은 줄이 배송 건마다 하나씩이다. 회신 줄 수가 그 합과 같아야 모두 실린 합배송이다.
    const key = seowonRowKey(group.rows[0]);
    const exported = group.ids.reduce((count, id) => count + seowonExportRows(byId.get(id)!.lines).filter(row => seowonRowKey(row) === key).length, 0);
    const tracking = new Set(group.rows.map(row => row.trackingNumber));
    if (tracking.size === 1 && group.rows.length === exported && group.rows.every(row => !row.error)) for (const id of group.ids) for (const row of group.rows) assign(id, row);
    else for (const row of group.rows) issue(row, row.error ?? SEOWON_REPLY_REASONS.splitIdentical);
  }
  const inUse = new Map<string, Set<string>>();
  for (const used of usedTracking) add(inUse, used.trackingNumber, used.shipmentId);
  const commands: SeowonReplyMatch['commands'] = [];
  for (const [id, matched] of assigned) {
    const lines = [...new Set(matched.map(row => row.line))].sort((a, b) => a - b);
    if (matched.some(row => row.error)) { for (const row of matched) issue(row, row.error ?? SEOWON_REPLY_REASONS.blockedSibling, shortId(id)); continue; }
    const tracking = new Set(matched.map(row => row.trackingNumber));
    if (tracking.size !== 1) { for (const row of matched) issue(row, SEOWON_REPLY_REASONS.conflictInFile, shortId(id)); continue; }
    // 배송 건은 송장 하나로 통째로 발송처리된다. 회신에 빠진 품목 줄이 있으면 일부 출고일 수 있어 멈춘다.
    // 같은 내용의 품목 줄이 여럿일 수 있으므로 줄의 개수로 비교한다.
    const replied = countKeys([...new Map(matched.map(row => [row.line, row])).values()]);
    if ([...countKeys(seowonExportRows(byId.get(id)!.lines))].some(([key, count]) => (replied.get(key) ?? 0) < count)) {
      for (const row of matched) issue(row, SEOWON_REPLY_REASONS.partial, shortId(id)); continue;
    }
    const trackingNumber = [...tracking][0];
    if ([...(inUse.get(trackingNumber) ?? [])].some(shipmentId => shipmentId !== id)) {
      for (const row of matched) issue(row, SEOWON_REPLY_REASONS.trackingInUse, shortId(id)); continue;
    }
    commands.push({ line: lines[0], shipmentId: id, orderId: byId.get(id)!.orderId, trackingNumber, lines });
  }
  // 한 송장(한 상자)은 받는 분 한 명에게 간다. 받는 분이 다른 배송 건에 같은 새 송장번호가 붙으면 모두 멈춘다.
  const recipientsByWaybill = new Map<string, Set<string>>();
  for (const command of commands) add(recipientsByWaybill, command.trackingNumber, recipientKey(byId.get(command.shipmentId)!.lines[0]));
  const crossed = commands.filter(command => recipientsByWaybill.get(command.trackingNumber)!.size > 1);
  for (const command of crossed) for (const row of assigned.get(command.shipmentId)!) issue(row, SEOWON_REPLY_REASONS.trackingSharedAcrossRecipients, shortId(command.shipmentId));
  return {
    commands: commands.filter(command => !crossed.includes(command)).sort((a, b) => a.line - b.line),
    unchanged: [...resent].map(([shipmentId, lines]) => ({ shipmentId, lines: [...new Set(lines)].sort((a, b) => a - b) })),
    issues: [...issues.values()].sort((a, b) => a.line - b.line || a.reason.localeCompare(b.reason)),
  };
}
