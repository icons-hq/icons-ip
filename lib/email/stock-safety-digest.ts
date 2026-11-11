/*
 * 안전재고 하루 1회 요약 메일 본문(QNA-014). 순수 함수 — 네트워크·DB·env를 모른다.
 *
 * 받는 사람은 운영자와 창고(출고지) 담당자다. 창고 담당자가 품목을 찾을 수 있게 판매자상품코드·관리코드와 함께
 * 등록된 ERP 코드·바코드를 싣는다. 어드민 링크는 운영자 메일에만 넣는다(창고는 어드민 계정이 없다).
 */
import { escapeHtml } from './templates';

export interface StockSafetyDigestItem {
  goodsCode: string; goodsName: string; optionName: string; optionCode: string;
  erpCode: string | null; erpName: string | null; barcode: string | null;
  stockQty: number; threshold: number; originName: string | null;
}
export interface StockSafetyDigestJobContent {
  audience: 'operator' | 'origin';
  originName: string | null;
  /** KST 날짜(YYYY-MM-DD). */
  digestDate: string;
  /** 이 메일 대상의 전체 옵션 수. items는 앞 300개까지다. */
  itemCount: number;
  items: StockSafetyDigestItem[];
}

const RECONCILE_PATH = '/admin/catalog/stock-reconcile';

function itemLine(item: StockSafetyDigestItem, withOrigin: boolean): string {
  const codes = [item.goodsCode, item.optionCode, item.erpCode ? `ERP ${item.erpCode}` : '', item.barcode ? `바코드 ${item.barcode}` : '']
    .filter(Boolean).join(' · ');
  const name = item.optionName && item.optionName !== '기본 옵션' ? `${item.goodsName} / ${item.optionName}` : item.goodsName;
  return `- ${name} (${codes}) — 재고 ${item.stockQty.toLocaleString('ko-KR')}개 / 기준 ${item.threshold.toLocaleString('ko-KR')}개${withOrigin && item.originName ? ` · ${item.originName}` : ''}`;
}

export function renderStockSafetyDigestEmail(job: StockSafetyDigestJobContent, siteUrl: string) {
  const scope = job.audience === 'origin' && job.originName ? `${job.originName} ` : '';
  const subject = `[ICONS] ${scope}안전재고 이하 옵션 ${job.itemCount.toLocaleString('ko-KR')}개 (${job.digestDate})`;
  const withOrigin = job.audience === 'operator';
  const rest = Math.max(0, job.itemCount - job.items.length);
  const intro = job.audience === 'origin'
    ? `${job.originName ?? '출고지'}에서 출고하는 ICONS 상품 중 재고수량이 안전재고 기준 이하인 옵션입니다. 실재고 확인과 입고 일정 공유를 부탁드립니다.`
    : '재고수량이 안전재고 기준 이하인 옵션입니다. 재고수량은 ICONS에서 판매할 수 있는 할당 재고이며 주문을 받으면 줄어듭니다.';
  const adminUrl = `${siteUrl}${RECONCILE_PATH}`;
  const lines = job.items.map((item) => itemLine(item, withOrigin));
  const footer = '이 메일은 ICONS 어드민의 안전재고 요약 메일 설정에 따라 하루 한 번 보냅니다. 받지 않으려면 ICONS 운영 담당자에게 알려주세요.';
  const text = [
    `${job.digestDate} 기준 ${intro}`,
    '',
    ...lines,
    ...(rest ? [`외 ${rest.toLocaleString('ko-KR')}개 옵션은 ICONS 어드민에서 확인해주세요.`] : []),
    '',
    ...(job.audience === 'operator' ? [`재고 대조·안전재고 메일 설정: ${adminUrl}`, ''] : []),
    footer,
  ].join('\n');
  const cell = 'padding:4px 8px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top';
  const rows = job.items.map((item) => `<tr><td style="${cell}">${escapeHtml(item.goodsName)}${item.optionName && item.optionName !== '기본 옵션' ? `<br>${escapeHtml(item.optionName)}` : ''}</td>`
    + `<td style="${cell}">${escapeHtml(item.goodsCode)}<br>${escapeHtml(item.optionCode)}</td>`
    + `<td style="${cell}">${escapeHtml(item.erpCode ?? '')}${item.barcode ? `<br>${escapeHtml(item.barcode)}` : ''}</td>`
    + `<td style="${cell};text-align:right">${item.stockQty.toLocaleString('ko-KR')}</td>`
    + `<td style="${cell};text-align:right">${item.threshold.toLocaleString('ko-KR')}</td>`
    + (withOrigin ? `<td style="${cell}">${escapeHtml(item.originName ?? '')}</td>` : '')
    + '</tr>').join('');
  const head = ['상품·옵션', '판매자상품코드·관리코드', 'ERP 코드·바코드', '재고수량', '안전재고 기준', ...(withOrigin ? ['출고지'] : [])]
    .map((label) => `<th style="${cell}">${label}</th>`).join('');
  const html = `<h1 style="font-size:18px">${escapeHtml(subject)}</h1><p>${escapeHtml(`${job.digestDate} 기준 ${intro}`)}</p>`
    + `<table style="border-collapse:collapse;font-size:13px"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`
    + (rest ? `<p>외 ${rest.toLocaleString('ko-KR')}개 옵션은 ICONS 어드민에서 확인해주세요.</p>` : '')
    + (job.audience === 'operator' ? `<p><a href="${escapeHtml(adminUrl)}">재고 대조·안전재고 메일 설정</a></p>` : '')
    + `<p style="color:#666;font-size:12px">${escapeHtml(footer)}</p>`;
  return { subject, text, html };
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function optionalText(value: unknown): string | null | undefined {
  return value === null || value === undefined ? null : typeof value === 'string' ? value : undefined;
}

/** DB 선점 결과의 옵션 한 줄. 모르는 모양은 null(그 작업은 발송하지 않고 결과 불명으로 남긴다). */
export function parseStockSafetyDigestItem(value: unknown): StockSafetyDigestItem | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const stockQty = nonNegativeInteger(row.stockQty); const threshold = nonNegativeInteger(row.threshold);
  const erpCode = optionalText(row.erpCode); const erpName = optionalText(row.erpName); const barcode = optionalText(row.barcode);
  const originName = optionalText(row.originName);
  if (typeof row.goodsCode !== 'string' || typeof row.goodsName !== 'string' || typeof row.optionName !== 'string'
    || typeof row.optionCode !== 'string' || stockQty === null || threshold === null
    || erpCode === undefined || erpName === undefined || barcode === undefined || originName === undefined) return null;
  return { goodsCode: row.goodsCode, goodsName: row.goodsName, optionName: row.optionName, optionCode: row.optionCode,
    erpCode, erpName, barcode, stockQty, threshold, originName };
}
