import type { ShipmentExportLine } from './shipment-workbook';
import { commerceReferenceLabel, isCommerceNumber } from '@/lib/commerce-number';

/**
 * 서원(남양주) 송장양식 교환 규칙. 내보내기와 회신 대조가 같은 행 규칙을 써야
 * 회신이 배송 건으로 돌아온다. 원형 7열 오른쪽에 받는분성명·배송메시지·배송건번호를
 * 덧붙이고, 회신에 배송건번호가 남아 있으면 그 번호로 정확히 대조한다.
 */
export type SeowonLine = Pick<ShipmentExportLine, 'recipient' | 'phone' | 'postalCode' | 'address' | 'goodName' | 'optionName' | 'qty' | 'deliveryNote'>;
export interface SeowonExportRow {
  phone: string; otherPhone: ''; postalCode: string; address: string; freightType: '';
  quantity: number; items: string; recipient: string; deliveryNote: string; shipmentNumber: string;
}
/** 한 파일에 싣는 배송 건. 합포장(`packId`)은 운영자가 일부러 묶은 한 상자라 접미사를 함께 쓴다. */
export interface SeowonExportShipment { id: string; shipmentNumber?: string | null; packId?: string | null; lines: readonly SeowonLine[] }

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

/** 원본처럼 품목 하나가 한 행이다. 받는 분 이름 접미사·배송건번호는 `seowonExportTable`이 붙인다. */
export function seowonExportRows(lines: readonly SeowonLine[], recipientSuffix = '', shipmentNumber = ''): SeowonExportRow[] {
  return lines.map(line => ({
    phone: formatSeowonPhone(line.phone), otherPhone: '', postalCode: /^\d{5}$/.test(line.postalCode) ? line.postalCode : '',
    address: squash(line.address), freightType: '', quantity: line.qty, items: seowonItemName(line.goodName, line.optionName),
    recipient: `${squash(line.recipient)}${recipientSuffix}`, deliveryNote: squash(line.deliveryNote), shipmentNumber,
  }));
}

/** 우체국 송장 프로그램이 한 송장으로 합치는 기준(받는 분 이름+전화). 공백은 비교에서 뺀다. */
const mergeKey = (line: Pick<SeowonLine, 'recipient' | 'phone'>) => `${squash(line.recipient).replace(/\s/g, '')}\u001f${digits(line.phone)}`;
/** 배송건번호 순서. 번호가 없는 옛 기록은 UUID로 줄 세운다. */
const shipmentOrder = (shipment: { id: string; shipmentNumber?: string | null }) => shipment.shipmentNumber ?? `~${shipment.id}`;
const suffixLabel = (index: number, count: number) => String(index + 1).padStart(Math.max(2, String(count).length), '0');

/**
 * 같은 받는 분(이름+전화)의 서로 다른 배송 건은 우체국 송장에서 하나로 합쳐진다(10/14 회의 A6).
 * 한 파일(한 번의 내보내기·한 출고지) 안에서 받는 분이 같은 배송 건이 둘 이상이면 이름 뒤에 배송건번호
 * 순서대로 01·02…를 붙여 송장을 따로 받게 한다. 운영자가 묶은 합포장은 한 상자이므로 구성 배송 건 모두 같은
 * 접미사를 쓴다. 접미사는 그 파일 구성으로만 정해지므로 내보낼 때 배송 건별로 기록하고(`admin_mark_seowon_shipments_exported`),
 * 회신은 그 기록과 맞춘다. 같은 배송 건이라도 다른 내보내기에서는 접미사가 다를 수 있다.
 */
export function seowonExportSuffixes(shipments: readonly SeowonExportShipment[]): Map<string, string> {
  const units = new Map<string, { key: string; order: string }>();
  for (const shipment of shipments) {
    if (!shipment.lines.length) continue;
    const unit = shipment.packId ? `pack:${shipment.packId}` : `shipment:${shipment.id}`;
    const order = shipmentOrder(shipment), current = units.get(unit);
    if (!current) units.set(unit, { key: mergeKey(shipment.lines[0]), order });
    else if (order < current.order) current.order = order;
  }
  const groups = new Map<string, { unit: string; order: string }[]>();
  for (const [unit, { key, order }] of units) groups.set(key, [...(groups.get(key) ?? []), { unit, order }]);
  const suffixes = new Map<string, string>();
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    members.sort((a, b) => a.order.localeCompare(b.order) || a.unit.localeCompare(b.unit));
    members.forEach((member, index) => suffixes.set(member.unit, suffixLabel(index, members.length)));
  }
  return new Map(shipments.map(shipment => [shipment.id, suffixes.get(shipment.packId ? `pack:${shipment.packId}` : `shipment:${shipment.id}`) ?? '']));
}

/** 서원 원형 양식 한 파일의 행. 이름 접미사는 `seowonExportSuffixes`가 정한다. */
export function seowonExportTable(shipments: readonly SeowonExportShipment[]): SeowonExportRow[] {
  const suffixes = seowonExportSuffixes(shipments);
  return shipments.flatMap(shipment => seowonExportRows(shipment.lines, suffixes.get(shipment.id) ?? '', shipment.shipmentNumber ?? ''));
}

/**
 * 내보내기 한 번에서 서원 원형 양식으로 나가는 배송 건의 접미사 기록. 파일은 출고지마다 하나라 출고지별로 정한다.
 * 기록할 서원 배송 건이 없으면 빈 배열이다.
 */
export function seowonExportLabels(shipments: readonly (SeowonExportShipment & { originId: string; template: string })[]): { shipmentId: string; suffix: string }[] {
  const byOrigin = new Map<string, SeowonExportShipment[]>();
  for (const shipment of shipments) if (shipment.template === 'seowon_xlsx') byOrigin.set(shipment.originId, [...(byOrigin.get(shipment.originId) ?? []), shipment]);
  return [...byOrigin.values()].flatMap(group => [...seowonExportSuffixes(group)].map(([shipmentId, suffix]) => ({ shipmentId, suffix })));
}

type RowIdentity = { phone: string; address: string; items: string; quantity: number | null };
/** 회신 줄을 배송 건에 잇는 열쇠. 우편번호는 원본 회신처럼 비어 올 수 있어 넣지 않는다. */
export const seowonRowKey = (row: RowIdentity) => [digits(row.phone), squash(row.address), squash(row.items), String(row.quantity ?? '')].join('\u001f');

export interface SeowonReplyRow extends RowIdentity {
  line: number; trackingNumber: string; error?: string;
  /** 회신의 받는분성명(덧붙인 열). 같은 내용의 배송 건을 접미사로 가를 때만 쓴다. */
  recipient?: string;
  /** 회신에 남은 16자리 배송건번호. 있으면 내용 대신 이 번호로 배송 건을 찾는다. */
  shipmentNumber?: string;
}
export interface SeowonReplyCandidate {
  id: string; shipmentNumber?: string | null; orderId: string; status: 'ready' | 'shipping' | 'delivered';
  trackingNumber: string | null; lines: SeowonLine[];
  /** 마지막으로 서원 원형 양식으로 내보낼 때 기록한 이름 접미사와 그 내보내기 묶음. 기록 전 배송 건은 없다. */
  seowonLabel?: { batch: string; suffix: string } | null;
  /** 운영자가 묶은 합포장. 구성 배송 건은 같은 송장으로 함께 등록해야 한다. */
  pack?: { id: string; shipmentIds: string[] } | null;
}
export interface SeowonReplyMatch {
  /** 발송처리할 배송 건마다 하나. `line`은 그 배송 건의 첫 회신 줄이다. */
  commands: { line: number; shipmentId: string; shipmentNumber?: string; orderId: string; trackingNumber: string; lines: number[] }[];
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
  numberMismatch: '배송건번호와 줄 내용(전화번호·주소·품목명·수량)이 출고지시 파일과 다릅니다. 내려받은 파일의 값은 그대로 두고 송장번호만 채워주세요.',
  suffixMismatch: '받는분성명 뒤의 번호(01·02 등)가 이 배송 건을 마지막으로 내보낸 출고지시 파일과 다릅니다. 내려받은 파일의 값은 그대로 두거나 주문 통합검색에서 배송 건별로 등록해주세요.',
  packIncomplete: '합포장의 다른 배송 건 줄이 회신에 없거나 송장번호가 다릅니다. 합포장 전체를 같은 송장번호로 올리거나 주문 통합검색에서 처리해주세요.',
} as const;

const label = (row: RowIdentity) => `전화 끝 ${digits(row.phone).slice(-4) || '없음'} · ${squash(row.items).slice(0, 40) || '품목명 없음'}`;
const recipientKey = (line: Pick<SeowonLine, 'phone' | 'address'>) => `${digits(line.phone)}\u001f${squash(line.address)}`;
function countKeys(rows: readonly RowIdentity[]) {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(seowonRowKey(row), (counts.get(seowonRowKey(row)) ?? 0) + 1);
  return counts;
}
function add(map: Map<string, Set<string>>, key: string, id: string) { map.set(key, (map.get(key) ?? new Set()).add(id)); }

const compactName = (value: string) => squash(value).replace(/\s/g, '');
/** 회신 받는분성명에서 이 배송 건의 기본 이름 뒤에 붙은 접미사. 이름이 맞지 않으면 null(판단 불가)이다. */
function replySuffix(row: SeowonReplyRow, candidate: SeowonReplyCandidate): string | null {
  const base = compactName(candidate.lines[0]?.recipient ?? ''), name = compactName(row.recipient ?? '');
  if (!base || !name || !name.startsWith(base)) return null;
  const suffix = name.slice(base.length);
  return /^([0-9]{2,3})?$/.test(suffix) ? suffix : null;
}

/**
 * 같은 내용의 여러 발송 대기 건이 송장 하나로 회신됐을 때(합포장·합배송), 접미사 기록이 있으면 회신 줄의 접미사가
 * 그 배송 건들의 기록과 같아야 함께 등록한다. 기록이 없거나 회신에 이름이 없으면 종전처럼 줄 수로만 판단한다.
 */
function suffixesAgree(ids: readonly string[], rows: readonly SeowonReplyRow[], byId: ReadonlyMap<string, SeowonReplyCandidate>, key: string) {
  if (!ids.every(id => byId.get(id)!.seowonLabel)) return true;
  const replied = rows.map(row => replySuffix(row, byId.get(ids[0])!));
  if (replied.some(suffix => suffix === null)) return !rows.some(row => row.recipient);
  const expected = ids.flatMap(id => Array<string>(seowonExportRows(byId.get(id)!.lines).filter(row => seowonRowKey(row) === key).length).fill(byId.get(id)!.seowonLabel!.suffix));
  return JSON.stringify([...replied].sort()) === JSON.stringify(expected.sort());
}

/**
 * 같은 내용(전화·주소·품목·수량)의 발송 대기 건이 여럿이고 서원이 송장을 따로 발급했을 때, 회신의 받는분성명 접미사를
 * 내보낼 때 배송 건별로 기록한 접미사와 정확히 맞춘다. 접미사마다 기록이 같은 배송 건이 하나(합포장이면 같은 묶음의
 * 구성원들)여야 하고, 한 내보내기 묶음에서 나온 기록이어야 한다. 기록이 없거나 어긋나는 접미사의 줄은 null로 돌려
 * 사람에게 넘긴다 — 지금 남은 후보의 순위로 추정하지 않는다.
 */
function splitBySuffix(ids: readonly string[], rows: readonly SeowonReplyRow[], byId: ReadonlyMap<string, SeowonReplyCandidate>, key: string) {
  const assigned = new Map<string, SeowonReplyRow[]>(), unresolved: SeowonReplyRow[] = [];
  const buckets = new Map<string, SeowonReplyRow[]>();
  for (const row of rows) {
    const suffix = row.error ? null : replySuffix(row, byId.get(ids[0])!);
    if (suffix === null || ids.some(id => compactName(byId.get(id)!.lines[0]?.recipient ?? '') !== compactName(byId.get(ids[0])!.lines[0]?.recipient ?? ''))) { unresolved.push(row); continue; }
    buckets.set(suffix, [...(buckets.get(suffix) ?? []), row]);
  }
  for (const [suffix, matched] of buckets) {
    const owners = ids.filter(id => byId.get(id)!.seowonLabel?.suffix === suffix);
    const batches = new Set(owners.map(id => byId.get(id)!.seowonLabel!.batch));
    const packs = new Set(owners.map(id => byId.get(id)!.pack?.id ?? `shipment:${id}`));
    const exported = owners.reduce((count, id) => count + seowonExportRows(byId.get(id)!.lines).filter(row => seowonRowKey(row) === key).length, 0);
    const single = owners.length === 1 && matched.length === exported;
    const pack = owners.length > 1 && packs.size === 1 && !packs.has(`shipment:${owners[0]}`) && new Set(matched.map(row => row.trackingNumber)).size === 1
      && matched.length === exported;
    if (!owners.length || batches.size !== 1 || !(single || pack)) { unresolved.push(...matched); continue; }
    for (const id of owners) assigned.set(id, [...(assigned.get(id) ?? []), ...matched]);
  }
  return { assigned, unresolved };
}

/**
 * 회신 줄을 배송 건으로 잇는다. 후보는 출고지시를 전달한 발송 대기 건과 최근 발송 건이다.
 * 회신에 배송건번호가 남아 있으면 그 배송 건만 보고, 줄 내용이 그 배송 건과 같을 때만 인정한다.
 * 번호가 없으면 줄 내용(전화·주소·품목명·수량)이 같은 배송 건만 인정하고 받는 분만 같은 건으로
 * 넘겨짚지 않는다. 먼저 같은 송장으로 이미 발송된 건인지(같은 회신을 다시 올림) 보고, 그다음 발송
 * 대기 건을 찾는다. 같은 내용의 발송 대기 건이 여럿이면 그 줄이 회신에 모두 있고 송장이 하나일 때
 * (합포장·합배송) 함께 등록하고, 송장이 따로 나왔으면 받는분성명 접미사로 가른다.
 * `usedTracking`은 기간과 관계없이 이미 다른 배송 건에 쓰인 송장번호다 — 예전 회신을 다시 올려도
 * 같은 내용의 새 주문이 옛 송장으로 발송되지 않는다.
 */
export function matchSeowonReply(
  rows: readonly SeowonReplyRow[], candidates: readonly SeowonReplyCandidate[],
  usedTracking: readonly { trackingNumber: string; shipmentId: string }[] = [],
): SeowonReplyMatch {
  const byId = new Map(candidates.map(candidate => [candidate.id, candidate]));
  const byNumber = new Map(candidates.flatMap(candidate => candidate.shipmentNumber ? [[candidate.shipmentNumber, candidate.id] as const] : []));
  const shortId = (id: string) => commerceReferenceLabel(id, byId.get(id)?.shipmentNumber);
  const ready = new Map<string, Set<string>>(), shipped = new Map<string, Set<string>>();
  for (const candidate of candidates) for (const row of seowonExportRows(candidate.lines))
    add(candidate.status === 'ready' ? ready : shipped, seowonRowKey(row), candidate.id);
  const issues = new Map<string, SeowonReplyMatch['issues'][number]>();
  const issue = (row: SeowonReplyRow, reason: string, reference = label(row)) => issues.set(`${row.line}:${reason}`, { line: row.line, reference, reason });
  const assigned = new Map<string, SeowonReplyRow[]>(), shared = new Map<string, { ids: string[]; rows: SeowonReplyRow[] }>();
  const resent = new Map<string, number[]>();
  const assign = (id: string, row: SeowonReplyRow) => assigned.set(id, [...(assigned.get(id) ?? []), row]);
  const resend = (id: string, row: SeowonReplyRow) => resent.set(id, [...(resent.get(id) ?? []), row.line]);
  for (const row of rows) {
    const key = seowonRowKey(row);
    if (row.shipmentNumber && isCommerceNumber(row.shipmentNumber, 'shipment')) {
      const id = byNumber.get(row.shipmentNumber), candidate = id ? byId.get(id)! : null;
      if (!id || !candidate) { issue(row, row.error ?? SEOWON_REPLY_REASONS.notFound, row.shipmentNumber); continue; }
      if (!seowonExportRows(candidate.lines).some(exported => seowonRowKey(exported) === key)) { issue(row, row.error ?? SEOWON_REPLY_REASONS.numberMismatch, row.shipmentNumber); continue; }
      if (candidate.status !== 'ready') {
        if (!row.error && candidate.trackingNumber === row.trackingNumber) resend(id, row);
        else issue(row, row.error ?? SEOWON_REPLY_REASONS.alreadyShipped, row.shipmentNumber);
        continue;
      }
      assign(id, row); continue;
    }
    const shippedIds = [...(shipped.get(key) ?? [])];
    const sameWaybill = row.error ? [] : shippedIds.filter(id => byId.get(id)!.trackingNumber === row.trackingNumber);
    if (sameWaybill.length) { for (const id of sameWaybill) resend(id, row); continue; }
    const readyIds = [...(ready.get(key) ?? [])].sort();
    if (readyIds.length === 1) {
      // 내보낼 때 기록한 접미사와 회신의 접미사가 다르면 다른 배송 건(취소·다른 파일)의 줄이다. 넘겨짚지 않는다.
      const candidate = byId.get(readyIds[0])!, suffix = replySuffix(row, candidate);
      if (!row.error && candidate.seowonLabel && suffix !== null && suffix !== candidate.seowonLabel.suffix) { issue(row, SEOWON_REPLY_REASONS.suffixMismatch); continue; }
      assign(readyIds[0], row);
    }
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
    if (tracking.size === 1 && group.rows.length === exported && group.rows.every(row => !row.error) && suffixesAgree(group.ids, group.rows, byId, key)) {
      for (const id of group.ids) for (const row of group.rows) assign(id, row);
      continue;
    }
    const split = splitBySuffix(group.ids, group.rows, byId, key);
    for (const [id, matched] of split.assigned) for (const row of matched) assign(id, row);
    for (const row of split.unresolved) issue(row, row.error ?? SEOWON_REPLY_REASONS.splitIdentical);
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
    const shipmentNumber = byId.get(id)!.shipmentNumber;
    commands.push({ line: lines[0], shipmentId: id, ...(shipmentNumber ? { shipmentNumber } : {}), orderId: byId.get(id)!.orderId, trackingNumber, lines });
  }
  // 합포장은 구성 배송 건 모두가 같은 송장으로 함께 등록돼야 한다. 빠지거나 송장이 갈린 묶음은 그 묶음만 멈춘다
  // (DB 일괄 등록이 합포장 전체를 요구해 파일 전체가 실패하지 않게 한다).
  const byShipment = new Map(commands.map(command => [command.shipmentId, command]));
  const unpacked = commands.filter(command => {
    const pack = byId.get(command.shipmentId)!.pack;
    if (!pack?.shipmentIds.length || pack.shipmentIds.every(id => byShipment.get(id)?.trackingNumber === command.trackingNumber)) return false;
    for (const row of assigned.get(command.shipmentId)!) issue(row, SEOWON_REPLY_REASONS.packIncomplete, shortId(command.shipmentId));
    return true;
  });
  const packed = commands.filter(command => !unpacked.includes(command));
  // 한 송장(한 상자)은 받는 분 한 명에게 간다. 받는 분이 다른 배송 건에 같은 새 송장번호가 붙으면 모두 멈춘다.
  const recipientsByWaybill = new Map<string, Set<string>>();
  for (const command of packed) add(recipientsByWaybill, command.trackingNumber, recipientKey(byId.get(command.shipmentId)!.lines[0]));
  const crossed = packed.filter(command => recipientsByWaybill.get(command.trackingNumber)!.size > 1);
  for (const command of crossed) for (const row of assigned.get(command.shipmentId)!) issue(row, SEOWON_REPLY_REASONS.trackingSharedAcrossRecipients, shortId(command.shipmentId));
  return {
    commands: packed.filter(command => !crossed.includes(command)).sort((a, b) => a.line - b.line),
    unchanged: [...resent].map(([shipmentId, lines]) => ({ shipmentId, lines: [...new Set(lines)].sort((a, b) => a - b) })),
    issues: [...issues.values()].sort((a, b) => a.line - b.line || a.reason.localeCompare(b.reason)),
  };
}
