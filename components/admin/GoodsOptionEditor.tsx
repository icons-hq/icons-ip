'use client';

import { useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { ArrowDown, ArrowUp, ChevronRight } from 'lucide-react';
import type { ErpItemMatch } from '@/lib/admin/erp-items';
import {
  applyErpItemToGoodsOption, applyGoodsOptionBulkEdit, collapseGoodsOptionRows, goodsOptionCollapseNotice, goodsOptionRowKey,
  goodsOptionStockTotals, isSingleGoodsOption, parseGoodsOptionBulkEdit, predictGoodsOptionCodes, removeGoodsOptionRows, selectErpItemForGoodsOption,
  emptyNewGoodsOptionStock, goodsOptionRowsForImport, shouldAutoFillErpSalePrice, GOODS_OPTION_AXIS_LIMIT, GOODS_OPTION_STOCK_REQUIRED,
  goodsOptionGenerationLabel, goodsOptionGenerationNotice, goodsOptionGenerationSummary, goodsOptionPreviousSingleStock, goodsOptionRemovalNotice,
  previewGoodsOptionGeneration, GOODS_OPTION_NONE_LABEL, GOODS_OPTION_STOP_PANEL_TITLE,
  type GoodsOptionAxis, type GoodsOptionBulkInput, type GoodsOptionRow, type GoodsOptionSavedCodes,
} from '@/lib/admin/goods-option-editor';
import { GOOD_EDITOR_HELP } from '@/lib/admin/help/good-editor';
import { GOOD_OPTIONS_HELP } from '@/lib/admin/help/good-options';
import { OPTION_AUTO_CODE_BARCODE_WARNING, looksLikeBarcode } from '@/lib/admin/goods-code-hint';
import { formatWon, planErpSalePrice, type GoodsPriceDraft } from '@/lib/admin/goods-price-editor';
import { ADMIN_VOCABULARY } from '@/lib/admin/vocabulary';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/admin/kit/ui/table';
import { AdminHelpTip } from './console/AdminHelpTip';
import { AdminField } from './console/AdminKit';
import { ErpItemNameInput } from './ErpItemNameInput';
import { GOOD_INPUT_CLASS, GOOD_NUMBER_INPUT_CLASS, GOOD_SUBPANEL_CLASS, GOOD_TABLE_FRAME_CLASS, GoodAmountField, GoodChoiceCard, GoodChoiceCards, GoodReadback } from './GoodEditorParts';
import { GoodsOptionImportPicker } from './GoodsOptionImportDialog';
import { AUTO_CODE_BADGE } from './GoodIdentifierFields';
import { GoodWorkspaceDetails } from './GoodWorkspace';
import type { GoodsOptionImportContext } from '@/lib/admin/goods-option-import';
import { adminConfirm } from '@/lib/admin/confirm';
import { StableNumberInput } from './StableNumberInput';

type GoodsOptionEditorProps = {
  rows: GoodsOptionRow[];
  baseline: string[];
  /** 옵션가를 더하는 판매 기준 금액(할인하면 할인가, 아니면 판매가) */
  basePrice: number;
  /**
   * 현재 판매가·할인 입력. ERP 판매가 적용은 이 입력으로 결과 금액을 다시 계산한다.
   * 없으면 basePrice를 할인 없는 판매가로 본다.
   */
  priceDraft?: GoodsPriceDraft;
  error?: string;
  axisValues?: Record<string, string>;
  onRowsChange: Dispatch<SetStateAction<GoodsOptionRow[]>>;
  /** 저장할 상품코드(입력값 또는 제안값). 빈 옵션 자동코드에 붙을 코드의 앞부분이다. */
  codePrefix?: string;
  /**
   * 저장된 상품코드와 이 상품의 저장된 옵션 전체(사용 중지한 옵션 포함). 빈 옵션 자동코드 칸에 저장 시 붙을 코드를 보이는 근거다.
   * 없으면 예상하지 않고 '저장 시 자동 생성'만 보인다.
   */
  savedCodes?: GoodsOptionSavedCodes;
  /** 옵션의 ERP 품명에서 반입된 ERP 품목을 골랐을 때 */
  onErpItemSelect?: (item: ErpItemMatch) => void;
  /** 옵션 미사용 상품에서 ERP 판매가 적용을 누르면 판매가 칸에 넣는다 */
  onRegularPriceApply?: (price: number) => void;
  /** 옵션 상세 정보 표 아래에 보이는 ERP 카테고리 안내 */
  erpNotice?: ReactNode;
  canSearchErp?: boolean;
  structureLocked?: boolean;
  optionImport?: GoodsOptionImportContext & { categories: { id: string; name: string }[]; onApplied: () => void };
};

/**
 * item: 옵션에 채운 ERP 품목(판매가 적용 버튼의 근거). 다른 옵션이 쓰는 품목이라 채우지 않았으면 없다.
 * warning: 채우거나 적용하지 못했거나, 적용했지만 결과 금액을 확인해야 하는 안내
 */
type ErpRowState = { item?: ErpItemMatch; message?: string; warning?: boolean };
type OptionUsage = 'on' | 'off';

const EMPTY_AXES: GoodsOptionAxis[] = Array.from({ length: GOODS_OPTION_AXIS_LIMIT }, () => ({ name: '', values: '' }));
const EMPTY_BULK: GoodsOptionBulkInput = { extraPrice: '', stockQty: '', isActive: '' };
const AUTO_CODE = '저장 시 자동 생성';
/* 머리글 아래 작은 줄: 사람이 넣는 칸인지 시스템이 만드는 칸인지와 어디에 찍히는지(ADR-0048). */
const HEAD_HINT_CLASS = 'block font-normal text-[11px] leading-snug';

/* 템플릿 룩(ADR-0028). */
const TABLE_HEAD_CLASS = 'px-3 text-xs font-medium whitespace-normal text-muted-foreground';
const TABLE_CELL_CLASS = 'px-3 py-2.5 align-top whitespace-normal';
/* 옵션 상세 안내 색(10/07 3차 리뷰): ERP 적용 성공은 성공색, 적용 실패·확인 필요는 경고색. 같은 칸의 재고 부족 경고는 경고색의 더 작은 글자. */
const ERP_MESSAGE_CLASS = { success: 'mt-1 block text-xs text-[var(--wc-success)]', warning: 'mt-1 block text-xs text-[var(--wc-warning)]' } as const;
const LOW_STOCK_CLASS = 'mt-1 block text-[11px] leading-normal text-[var(--wc-warning)]';

function wholeNumber(raw: string): number {
  return raw === '' ? 0 : Number(raw);
}

/**
 * 재고수량 칸(0901-015, 11/11 결정 "비우면 저장 불가"). 빈 칸은 빈 값(NaN)으로 두고 0으로 바꾸지 않는다. 비어 있으면 상품 저장을
 * 브라우저 검증으로 막고 안내 문구를 보인다(편집기가 재고수량·옵션 칸 오류로 붙인다). 0은 직접 입력하면 저장된다.
 * 늘 보이던 안내 문단은 뺐다 — 빈 칸에는 넣을 값("없으면 0")이 보이고, 비운 채 저장하면 그 칸에 이유가 뜬다.
 */
function StockQtyInput({ value, onChange, ...props }: { value: number; onChange: (value: number) => void; id?: string; 'aria-label'?: string; className?: string }) {
  const empty = !Number.isFinite(value);
  /* 저장을 눌러 검증에 걸린 빈 칸만 오류로 칠한다(처음부터 빨갛게 보이지 않게). 값을 넣으면 풀린다. */
  const [rejected, setRejected] = useState(false);
  const flagged = empty && rejected;
  /* 입력 도중의 폼 렌더가 친 글자를 지우지 않게 값이 바뀔 때만 칸을 고친다(StableNumberInput, 원장 재작업 후속 6). */
  return <StableNumberInput {...props} data-slot="input" value={empty ? '' : String(value)} min={0} step={1} required placeholder="없으면 0"
    aria-invalid={flagged ? true : undefined} className={`${props.className ?? ''}${flagged ? ' border-destructive ring-1 ring-destructive/40' : ''}`}
    ref={(input) => { input?.setCustomValidity(empty ? GOODS_OPTION_STOCK_REQUIRED : ''); }}
    onInvalid={() => setRejected(true)}
    onChange={(event) => { setRejected(false); onChange(event.target.value === '' ? Number.NaN : Number(event.target.value)); }} />;
}

function OptionDetailTable({ rows, single, predictedCodes, savedCodes, update, erpRows, onErpChange, onErpSelect, onErpPrice, notice, canSearchErp, structureLocked }: {
  rows: GoodsOptionRow[];
  savedCodes?: GoodsOptionSavedCodes;
  single: boolean;
  predictedCodes: (string | null)[];
  update: (key: string, changes: Partial<GoodsOptionRow>) => void;
  erpRows: Record<string, ErpRowState>;
  onErpChange: (key: string, value: string) => void;
  onErpSelect: (key: string, item: ErpItemMatch) => void;
  onErpPrice: (key: string, salePrice: number) => void;
  notice?: ReactNode;
  canSearchErp: boolean;
  structureLocked?: boolean;
}) {
  /* 옵션 자동코드는 시스템이 저장할 때 만든다. 기본은 잠그고, 창고 품번이 있거나 잘못 들어간 값을 고칠 때만 연다(ADR-0048). */
  const [codesOpen, setCodesOpen] = useState(false);
  const optionCode = ADMIN_VOCABULARY.optionCode;
  function lockCodes() {
    /* 다시 잠그면 저장된 코드로 되돌린다. 새 옵션은 비워 저장할 때 만들게 한다. 저장된 코드를 모르면 입력값을 그대로 둔다. */
    if (savedCodes) {
      const saved = new Map(savedCodes.options.map((option) => [option.id, option.code]));
      for (const row of rows) update(goodsOptionRowKey(row), { code: row.id ? saved.get(row.id) ?? row.code : '' });
    }
    setCodesOpen(false);
  }
  /* 펼침 상태는 저장 시도 뒤에도 유지한다(R14). */
  return <GoodWorkspaceDetails stateId="good-option-details" className="group/option-details min-w-0 rounded-lg border" data-good-option-details="">
    <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium outline-none select-none group-open/option-details:rounded-b-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
      <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-open/option-details:rotate-90 motion-reduce:transition-none" />
      {`옵션 상세 정보 · ERP 코드·바코드·ERP 품명·${optionCode}·안전재고`}
    </summary>
    <div className="flex min-w-0 flex-col gap-3 border-t p-3">
      {/* 2026-11-19 MD가 받은 엑셀의 '코드'(ERP 코드)를 옛 '관리코드' 칸에 넣어 거래확정 엑셀의 ERP 코드가 비었다.
          어느 칸에 무엇을 넣고 어느 엑셀에 찍히는지는 긴 안내 문단 대신 그 칸에서 보인다: 머리글 아래 작은 줄(직접 입력·찍히는 엑셀),
          입력칸 예시(엑셀의 '코드'), 잠긴 옵션 자동코드. 이름이 비슷해 헷갈리는 ERP 코드·ERP 품명·옵션 자동코드에만 "?"를 단다. */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1" data-good-option-code-lock={codesOpen ? 'open' : 'locked'}>
        <button type="button" className={buttonVariants({ variant: 'ghost', size: 'xs' })} data-slot="button" onClick={() => codesOpen ? lockCodes() : setCodesOpen(true)}>
          {codesOpen ? `${optionCode} 다시 잠그기` : `${optionCode} 직접 바꾸기`}
        </button>
        {codesOpen && <span className="text-xs text-[var(--wc-warning)]" role="status">창고 품번처럼 정해진 코드가 있거나 잘못 들어간 값을 고칠 때만 바꿉니다. 바코드·ERP 코드는 {optionCode} 칸이 아니라 왼쪽의 바코드·ERP 코드 칸에 넣습니다.</span>}
      </div>
      <div className={GOOD_TABLE_FRAME_CLASS} role="region" aria-label="옵션 ERP 정보와 안전재고 상세" tabIndex={0}>
        <Table className="min-w-[58rem] table-fixed">
          <TableCaption className="sr-only">{`옵션별 ERP 코드·바코드·ERP 품명·${optionCode}·안전재고 기준`}</TableCaption>
          <TableHeader className="bg-muted/50"><TableRow className="hover:bg-transparent">
            <TableHead scope="col" className={`w-[15%] ${TABLE_HEAD_CLASS}`}>옵션</TableHead>
            <TableHead scope="col" className={`w-[15%] ${TABLE_HEAD_CLASS}`}>ERP 코드<AdminHelpTip className="ml-1 align-middle" help={GOOD_OPTIONS_HELP.erpCode} label="ERP 코드" /><span className={HEAD_HINT_CLASS}>직접 입력 · 거래확정·출고 엑셀에 찍힘</span></TableHead>
            <TableHead scope="col" className={`w-[16%] ${TABLE_HEAD_CLASS}`}>바코드<span className={HEAD_HINT_CLASS}>직접 입력 · 거래확정·출고 엑셀에 찍힘</span></TableHead>
            <TableHead scope="col" className={`w-[23%] ${TABLE_HEAD_CLASS}`}>ERP 품명{canSearchErp && <><AdminHelpTip className="ml-1 align-middle" help={GOOD_OPTIONS_HELP.erpName} label="ERP 품명" /><span className={HEAD_HINT_CLASS}>이름으로 검색해 채우기</span></>}</TableHead>
            <TableHead scope="col" className={`w-[17%] ${TABLE_HEAD_CLASS}`}>{optionCode}<AdminHelpTip className="ml-1 align-middle" help={GOOD_OPTIONS_HELP.optionAutoCode} label={optionCode} /><span className={HEAD_HINT_CLASS}>{codesOpen ? '직접 바꾸는 중' : AUTO_CODE_BADGE}</span></TableHead>
            <TableHead scope="col" className={`w-[14%] ${TABLE_HEAD_CLASS}`}>안전재고 기준</TableHead>
          </TableRow></TableHeader>
          <TableBody>{rows.map((row, index) => {
            const key = goodsOptionRowKey(row);
            const erp = erpRows[key];
            const erpSalePrice = erp?.item?.salePrice ?? null;
            const tone = erp?.warning ? 'warning' : 'success';
            return <TableRow key={key} data-variant-id={row.id ?? undefined}>
              <TableCell className={`${TABLE_CELL_CLASS} wrap-anywhere`}>{single
                ? <input className={GOOD_INPUT_CLASS} data-slot="input" readOnly={structureLocked} aria-label="옵션 이름" value={row.name} maxLength={200} onChange={(event) => update(key, { name: event.target.value })} />
                : row.name || `옵션 ${index + 1}`}</TableCell>
              <TableCell className={TABLE_CELL_CLASS}><input className={GOOD_INPUT_CLASS} data-slot="input" aria-label={`옵션 ${index + 1} ERP 코드`} value={row.erpCode ?? ''} maxLength={120} placeholder="엑셀의 '코드'" onChange={(event) => update(key, { erpCode: event.target.value })} /></TableCell>
              <TableCell className={TABLE_CELL_CLASS}><input className={GOOD_INPUT_CLASS} data-slot="input" aria-label={`옵션 ${index + 1} 바코드`} value={row.barcode ?? ''} maxLength={120} placeholder="엑셀의 '바코드'" onChange={(event) => update(key, { barcode: event.target.value })} /></TableCell>
              <TableCell className={TABLE_CELL_CLASS}>
                {canSearchErp ? <ErpItemNameInput value={row.erpName ?? ''} onChange={(value) => onErpChange(key, value)} onSelect={(item) => onErpSelect(key, item)}
                  ariaLabel={`옵션 ${index + 1} ERP 품명`} maxLength={200} placeholder="이름으로 검색" /> : <input className={GOOD_INPUT_CLASS} data-slot="input" aria-label={`옵션 ${index + 1} ERP 품명`} value={row.erpName ?? ''} onChange={event => onErpChange(key, event.target.value)} maxLength={200} placeholder="ERP 상품 이름" />}
                {erpSalePrice !== null && <button type="button" className={`${buttonVariants({ variant: 'outline', size: 'xs' })} mt-1.5 h-auto min-h-6 whitespace-normal`} data-slot="button" onClick={() => onErpPrice(key, erpSalePrice)}>
                  ERP 판매가 {formatWon(erpSalePrice)} 적용
                </button>}
                {erp?.message && <small role="status" className={ERP_MESSAGE_CLASS[tone]} data-good-option-erp-message="" data-tone={tone}>{erp.message}</small>}
              </TableCell>
              <TableCell className={TABLE_CELL_CLASS}><input className={GOOD_INPUT_CLASS} data-slot="input" readOnly={!codesOpen} id={single ? 'goods-single-code' : undefined} aria-label={single ? optionCode : `옵션 ${index + 1} ${optionCode}`} aria-describedby={looksLikeBarcode(row.code) ? `goods-option-code-barcode-${index}` : undefined} value={row.code} maxLength={120} placeholder={codesOpen ? '창고 품번처럼 정해진 코드' : predictedCodes[index] ? `${AUTO_CODE} · 예상 ${predictedCodes[index]}` : AUTO_CODE} onChange={(event) => update(key, { code: event.target.value })} />
                {/* 잠긴 칸에 이미 들어간 바코드도 열어 보지 않고 알아보게 한다. 창고 품번일 수 있어 막지는 않는다. */}
                {looksLikeBarcode(row.code) && <small className={LOW_STOCK_CLASS} data-good-option-code-barcode="" data-tone="warning" id={`goods-option-code-barcode-${index}`} role="status">{OPTION_AUTO_CODE_BARCODE_WARNING}</small>}
              </TableCell>
              <TableCell className={TABLE_CELL_CLASS}>
                <StableNumberInput className={GOOD_NUMBER_INPUT_CLASS} data-slot="input" aria-label={`옵션 ${index + 1} 안전재고 기준`} value={row.lowStockThreshold == null ? '' : String(row.lowStockThreshold)} min={0} max={2147483647} step={1} placeholder="비우면 알림 없음" onChange={(event) => update(key, { lowStockThreshold: event.target.value === '' ? null : Number(event.target.value) })} />
                {row.lowStockThreshold != null && row.stockQty <= row.lowStockThreshold && <small className={LOW_STOCK_CLASS} data-good-option-low-stock="" data-tone="warning">재고 부족 · 기준 {row.lowStockThreshold.toLocaleString('ko-KR')}개 이하</small>}
              </TableCell>
            </TableRow>;
          })}</TableBody>
        </Table>
      </div>
      {notice}
    </div>
  </GoodWorkspaceDetails>;
}

function OptionInputs({ axes, rows, hidden, setAxes, setRows, onCreatedFromSingle }: {
  axes: GoodsOptionAxis[];
  rows: GoodsOptionRow[];
  hidden: boolean;
  setAxes: Dispatch<SetStateAction<GoodsOptionAxis[]>>;
  setRows: Dispatch<SetStateAction<GoodsOptionRow[]>>;
  /** 옵션 없음에서 처음 옵션을 만들었을 때, 옵션 없이 넣어 둔 재고수량(1개 이상일 때만 숫자). */
  onCreatedFromSingle: (previousStock: number | null) => void;
}) {
  /* 세 번째 옵션명은 드물게 쓴다. 입력은 DOM에 남겨 두고(저장·복구가 같은 이름을 읽는다) 값이 있거나 옵션명 추가를 누를 때만 보인다. */
  const [extraAxisOpen, setExtraAxisOpen] = useState(false);
  const extraAxisShown = extraAxisOpen || axes.slice(2).some((axis) => axis.name.trim() || axis.values.trim());
  /* 적는 동안 결과를 바로 보인다: 몇 개가 만들어지는지, 지금 목록에서 무엇이 남고 빠지는지. 버튼 이름도 그 결과다. */
  const preview = previewGoodsOptionGeneration(axes, rows);
  const summary = goodsOptionGenerationSummary(preview);
  const label = goodsOptionGenerationLabel(preview);
  async function create() {
    if (preview.state !== 'ready') return;
    /* 지금 목록에서 빠지는 것이 있을 때만 묻는다(규칙 7). 빠지는 것이 없으면 바로 만든다. */
    const notice = goodsOptionGenerationNotice(preview);
    if (notice && !await adminConfirm({ title: preview.fromSingle ? `옵션 ${preview.count}개를 만들까요?` : `옵션을 ${preview.count}개로 바꿀까요?`, message: notice, confirmLabel: label })) return;
    setRows(preview.rows);
    if (preview.fromSingle) onCreatedFromSingle(goodsOptionPreviousSingleStock(preview));
  }
  return <section className={GOOD_SUBPANEL_CLASS} aria-labelledby="goods-option-inputs-title" data-good-option-inputs="" hidden={hidden}>
    <div className="flex items-center gap-1">
      <h3 id="goods-option-inputs-title" className="text-sm leading-snug font-medium text-foreground">옵션명과 옵션값</h3>
      <AdminHelpTip help={GOOD_EDITOR_HELP.optionNames} label="옵션명과 옵션값" />
    </div>
    {axes.map((axis, index) => <div className="grid min-w-0 gap-x-4 gap-y-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]" hidden={index >= 2 && !extraAxisShown} key={index}>
      {/* 옵션명이 3개까지인 이유와 더 필요할 때의 방법은 세 번째 옵션명 옆 "?"에서도 본다. */}
      <AdminField inputId={`option-axis-${index}`} label={`옵션명 ${index + 1}${index ? ' (선택)' : ''}`} help={index === GOODS_OPTION_AXIS_LIMIT - 1 ? GOOD_EDITOR_HELP.optionNames : undefined}>
        <input className={GOOD_INPUT_CLASS} data-slot="input" id={`option-axis-${index}`} name={`optionAxisName${index}`} value={axis.name} maxLength={40} placeholder={['예: 색상', '예: 사이즈', '예: 구성'][index]} onChange={(event) => setAxes((old) => old.map((item, i) => i === index ? { ...item, name: event.target.value } : item))} />
      </AdminField>
      <AdminField inputId={`option-values-${index}`} label={`옵션값 ${index + 1} (쉼표로 구분)`}>
        <input className={GOOD_INPUT_CLASS} data-slot="input" id={`option-values-${index}`} name={`optionAxisValues${index}`} value={axis.values} placeholder={['예: 빨강, 파랑', '예: S, M, L', '예: 기본, 선물포장'][index]} onChange={(event) => setAxes((old) => old.map((item, i) => i === index ? { ...item, values: event.target.value } : item))} />
      </AdminField>
    </div>)}
    {extraAxisShown ? null : <button type="button" className={`${buttonVariants({ variant: 'ghost', size: 'sm' })} self-start`} data-slot="button" onClick={() => setExtraAxisOpen(true)}>옵션명 추가</button>}
    {summary === null ? null : preview.state === 'ready' || preview.state === 'same'
      ? <GoodReadback>{summary}</GoodReadback>
      : <p className="text-sm text-[var(--wc-warning)]" data-good-option-preview={preview.state} data-tone="warning" role="status">{summary}</p>}
    <button type="button" className={`${buttonVariants({ variant: preview.state === 'ready' ? 'secondary' : 'outline' })} self-start`} data-slot="button" data-good-option-create="" disabled={preview.state !== 'ready'} onClick={() => void create()}>{label}</button>
  </section>;
}

function OptionList({ rows, basePrice, update, setRows }: {
  rows: GoodsOptionRow[];
  basePrice: number;
  update: (key: string, changes: Partial<GoodsOptionRow>) => void;
  setRows: Dispatch<SetStateAction<GoodsOptionRow[]>>;
}) {
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set());
  const [bulk, setBulk] = useState<GoodsOptionBulkInput>(EMPTY_BULK);
  const [bulkMessage, setBulkMessage] = useState<{ text: string; failed: boolean } | null>(null);
  const keys = rows.map(goodsOptionRowKey);
  /* 지워지거나 다시 만든 행의 선택은 남기지 않는다. */
  const selected = new Set(keys.filter((key) => checked.has(key)));
  const allSelected = selected.size === rows.length;
  function move(index: number, direction: number) {
    setRows((current) => { const next = [...current]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; return next; });
  }
  function toggle(key: string, on: boolean) {
    setChecked(() => { const next = new Set(selected); if (on) next.add(key); else next.delete(key); return next; });
  }
  function applyBulk() {
    const parsed = parseGoodsOptionBulkEdit(bulk);
    if (!parsed.ok) { setBulkMessage({ text: parsed.error, failed: true }); return; }
    setRows((current) => applyGoodsOptionBulkEdit(current, selected, parsed.edit));
    setBulkMessage({ text: `선택한 옵션 ${selected.size}개를 수정했습니다. 저장해야 반영됩니다.`, failed: false });
  }
  /* 저장된 옵션을 뺄 때만 무엇이 일어나는지 말하고 확인받는다(규칙 7). 아직 저장한 적 없는 새 줄은 묻지 않는다. */
  async function confirmRemoval(removed: GoodsOptionRow[]) {
    const notice = goodsOptionRemovalNotice(removed);
    return !notice || adminConfirm({ title: '옵션을 목록에서 뺄까요?', message: notice, confirmLabel: '목록에서 빼기' });
  }
  async function removeSelected() {
    const result = removeGoodsOptionRows(rows, selected);
    if (!result.ok) { setBulkMessage({ text: result.error, failed: true }); return; }
    if (!await confirmRemoval(rows.filter((row) => selected.has(goodsOptionRowKey(row))))) return;
    setRows(result.rows); setChecked(new Set());
    setBulkMessage({ text: `옵션 ${selected.size}개를 목록에서 뺐습니다. 상품을 저장해야 반영됩니다.`, failed: false });
  }
  async function removeRow(key: string) {
    if (!await confirmRemoval(rows.filter((row) => goodsOptionRowKey(row) === key))) return;
    setRows((current) => current.filter((item) => goodsOptionRowKey(item) !== key));
  }
  const bulkTone = bulkMessage?.failed ? 'warning' : 'success';
  return <section className={GOOD_SUBPANEL_CLASS} aria-labelledby="goods-option-list-title">
    <h3 id="goods-option-list-title" className="text-sm leading-snug font-medium text-foreground">옵션목록 (총 {rows.length.toLocaleString('ko-KR')}개)</h3>
    <div className="flex min-w-0 flex-wrap items-end gap-x-3 gap-y-2 rounded-lg bg-muted/50 p-3" role="group" aria-label="선택목록 일괄수정">
      <label className="inline-flex min-h-8 cursor-pointer items-center gap-2 text-sm font-medium text-foreground">
        <input type="checkbox" aria-label="옵션 전체 선택" checked={rows.length > 0 && allSelected}
          ref={(node) => { if (node) node.indeterminate = selected.size > 0 && !allSelected; }}
          onChange={(event) => setChecked(event.target.checked ? new Set(keys) : new Set())} />
        <span>{selected.size ? `${selected.size}개 선택` : '전체 선택'}</span>
      </label>
      <label className="flex min-w-0 flex-[1_1_7rem] flex-col gap-1 text-xs text-muted-foreground sm:max-w-32">옵션가<input className={GOOD_NUMBER_INPUT_CLASS} data-slot="input" type="text" inputMode="numeric" aria-label="선택 옵션 옵션가" placeholder="변경 안 함" value={bulk.extraPrice} onChange={(event) => setBulk((old) => ({ ...old, extraPrice: event.target.value }))} /></label>
      <label className="flex min-w-0 flex-[1_1_7rem] flex-col gap-1 text-xs text-muted-foreground sm:max-w-32">재고수량<input className={GOOD_NUMBER_INPUT_CLASS} data-slot="input" type="text" inputMode="numeric" aria-label="선택 옵션 재고수량" placeholder="변경 안 함" value={bulk.stockQty} onChange={(event) => setBulk((old) => ({ ...old, stockQty: event.target.value }))} /></label>
      <div className="flex min-w-0 flex-[1_1_7rem] flex-col gap-1 sm:max-w-32">
        <label className="text-xs text-muted-foreground" htmlFor="goods-option-bulk-active">사용여부</label>
        <NativeSelect className="w-full" id="goods-option-bulk-active" aria-label="선택 옵션 사용여부" value={bulk.isActive} onChange={(event) => setBulk((old) => ({ ...old, isActive: event.target.value as GoodsOptionBulkInput['isActive'] }))}>
          <option value="">변경 안 함</option><option value="active">사용</option><option value="stopped">사용 중지</option>
        </NativeSelect>
      </div>
      <button type="button" className={buttonVariants({ variant: 'outline' })} data-slot="button" disabled={!selected.size} onClick={applyBulk}>선택목록 일괄수정</button>
      <button type="button" className={buttonVariants({ variant: 'outline' })} data-slot="button" disabled={!selected.size} onClick={() => void removeSelected()}>선택삭제</button>
    </div>
    {bulkMessage && <p className={bulkTone === 'warning' ? 'text-xs text-[var(--wc-warning)]' : 'text-xs text-[var(--wc-success)]'} data-tone={bulkTone} role="status">{bulkMessage.text}</p>}
    <div className={GOOD_TABLE_FRAME_CLASS} data-good-option-list="" role="region" aria-label="옵션목록 편집표" tabIndex={0}>
      {/* 7개 열은 좁은 화면에서 줄이지 않고 표 영역 안에서 가로로 이동한다. 옵션 자동코드는 옵션 상세 정보에 있다. */}
      <Table className="min-w-[46rem] table-fixed">
        <TableCaption className="sr-only">선택·옵션·옵션가·재고수량·사용여부·순서·삭제</TableCaption>
        <TableHeader className="bg-muted/50"><TableRow className="hover:bg-transparent">
          <TableHead scope="col" className={`w-12 text-center ${TABLE_HEAD_CLASS}`}><span className="sr-only">선택</span></TableHead>
          <TableHead scope="col" className={`w-[30%] ${TABLE_HEAD_CLASS}`}>옵션</TableHead>
          <TableHead scope="col" className={`w-[18%] ${TABLE_HEAD_CLASS}`}>{ADMIN_VOCABULARY.optionPrice}<AdminHelpTip className="ml-1 align-middle" help={GOOD_EDITOR_HELP.optionExtraPrice} label={ADMIN_VOCABULARY.optionPrice} /></TableHead>
          <TableHead scope="col" className={`w-[15%] ${TABLE_HEAD_CLASS}`}>{ADMIN_VOCABULARY.stockQuantity}</TableHead>
          <TableHead scope="col" className={`w-[14%] ${TABLE_HEAD_CLASS}`}>사용여부</TableHead>
          <TableHead scope="col" className={`w-24 ${TABLE_HEAD_CLASS}`}>순서</TableHead>
          <TableHead scope="col" className={`w-20 ${TABLE_HEAD_CLASS}`}>삭제</TableHead>
        </TableRow></TableHeader>
        <TableBody>{rows.map((row, index) => {
          const key = keys[index];
          const isSelected = selected.has(key);
          return <TableRow key={key} data-variant-id={row.id ?? undefined} data-selected={isSelected || undefined} data-state={isSelected ? 'selected' : undefined}>
            <TableCell className={`${TABLE_CELL_CLASS} text-center`}><input type="checkbox" className="mt-2" aria-label={`옵션 ${index + 1} 선택`} checked={isSelected} onChange={(event) => toggle(key, event.target.checked)} /></TableCell>
            <TableCell className={TABLE_CELL_CLASS}>
              <input className={GOOD_INPUT_CLASS} data-slot="input" aria-label={`옵션 ${index + 1} 이름`} value={row.name} maxLength={200} onChange={(event) => update(key, { name: event.target.value })} />
              {/* 사용 중지로 저장한 옵션이 어디로 가는지 그 자리에서 알린다. 첫 줄은 저장 뒤에도 이 목록에 남는다(상품 편집은 사용 중인 옵션과 첫 옵션만 연다). */}
              {row.isActive === false && <small className="mt-1 block text-xs text-[var(--wc-warning)]" data-good-option-stopped="">{index === 0
                ? '사용 중지 · 고객이 고를 수 없습니다'
                : `사용 중지 · 저장하면 아래 '${GOODS_OPTION_STOP_PANEL_TITLE}'으로 옮겨집니다`}</small>}
            </TableCell>
            <TableCell className={TABLE_CELL_CLASS}>
              <StableNumberInput className={GOOD_NUMBER_INPUT_CLASS} data-slot="input" aria-label={`옵션 ${index + 1} 옵션가`} value={Number.isFinite(row.extraPrice) ? String(row.extraPrice) : ''} min={0} step={1} onChange={(event) => update(key, { extraPrice: wholeNumber(event.target.value) })} />
              <small className="mt-1 block text-[11px] text-muted-foreground tabular-nums">판매 {formatWon(basePrice + (Number.isFinite(row.extraPrice) ? row.extraPrice : 0))}</small>
            </TableCell>
            <TableCell className={TABLE_CELL_CLASS}><StockQtyInput className={GOOD_NUMBER_INPUT_CLASS} aria-label={`옵션 ${index + 1} 재고수량`} value={row.stockQty} onChange={(stockQty) => update(key, { stockQty })} /></TableCell>
            <TableCell className={TABLE_CELL_CLASS}><NativeSelect className="w-full" aria-label={`옵션 ${index + 1} 사용여부`} value={row.isActive === false ? 'stopped' : 'active'} onChange={(event) => update(key, { isActive: event.target.value === 'active' })}>
              <option value="active">사용</option><option value="stopped">사용 중지</option>
            </NativeSelect></TableCell>
            <TableCell className={TABLE_CELL_CLASS}><div className="flex flex-wrap gap-1">
              <button type="button" className={buttonVariants({ variant: 'outline', size: 'icon-sm' })} data-slot="button" aria-label={`옵션 ${index + 1} 위로`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp aria-hidden="true" /></button>
              <button type="button" className={buttonVariants({ variant: 'outline', size: 'icon-sm' })} data-slot="button" aria-label={`옵션 ${index + 1} 아래로`} disabled={index === rows.length - 1} onClick={() => move(index, 1)}><ArrowDown aria-hidden="true" /></button>
            </div></TableCell>
            <TableCell className={TABLE_CELL_CLASS}><button type="button" className={buttonVariants({ variant: 'destructive', size: 'sm' })} data-slot="button" aria-label={`옵션 ${index + 1} 삭제`} disabled={rows.length === 1} onClick={() => void removeRow(key)}>삭제</button></TableCell>
          </TableRow>;
        })}</TableBody>
      </Table>
    </div>
  </section>;
}

function SingleStock({ row, basePrice, update, structureLocked }: {
  row: GoodsOptionRow;
  structureLocked?: boolean;
  basePrice: number;
  update: (key: string, changes: Partial<GoodsOptionRow>) => void;
}) {
  const key = goodsOptionRowKey(row);
  /* 옵션가는 옵션 없이 파는 상품에 보통 쓰지 않는다. 기존 값이 있을 때만 보이고 편집 중에는 사라지지 않는다. */
  const [extraVisible, setExtraVisible] = useState(false);
  /* 사용여부도 같다. 사용 중지된 첫 옵션만 남은 상품은 여기서 되돌린다. */
  const [activeVisible, setActiveVisible] = useState(false);
  return <div className="grid min-w-0 items-start gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
    <AdminField inputId="goods-single-stock" label="재고수량 (필수)" help={GOOD_EDITOR_HELP.stockQty}>
      <GoodAmountField unit="개">
        <StockQtyInput className={GOOD_NUMBER_INPUT_CLASS} id="goods-single-stock" value={row.stockQty} onChange={(stockQty) => update(key, { stockQty })} />
      </GoodAmountField>
    </AdminField>
    {(extraVisible || row.extraPrice !== 0) && <AdminField inputId="goods-single-extra-price" label={ADMIN_VOCABULARY.optionPrice} help={GOOD_EDITOR_HELP.optionExtraPrice}>
      <GoodAmountField unit="원">
        <StableNumberInput className={GOOD_NUMBER_INPUT_CLASS} data-slot="input" id="goods-single-extra-price" aria-describedby="goods-single-extra-price-result" value={Number.isFinite(row.extraPrice) ? String(row.extraPrice) : ''} min={0} step={1} onChange={(event) => { setExtraVisible(true); update(key, { extraPrice: wholeNumber(event.target.value) }); }} />
      </GoodAmountField>
      <small className="text-xs text-muted-foreground tabular-nums" id="goods-single-extra-price-result">판매 {formatWon(basePrice + (Number.isFinite(row.extraPrice) ? row.extraPrice : 0))}</small>
    </AdminField>}
    {(activeVisible || row.isActive === false) && <AdminField inputId="goods-single-active" label="사용여부" hint="사용 중지하면 고객이 살 수 없습니다. 주문 기록과 재고는 그대로 남습니다.">
      <NativeSelect className="w-full sm:max-w-xs" disabled={structureLocked} id="goods-single-active" aria-describedby="goods-single-active-hint" value={row.isActive === false ? 'stopped' : 'active'}
        onChange={(event) => { setActiveVisible(true); update(key, { isActive: event.target.value === 'active' }); }}>
        <option value="active">사용</option><option value="stopped">사용 중지</option>
      </NativeSelect>
    </AdminField>}
  </div>;
}

export function GoodsOptionEditor({
  rows, baseline, basePrice, priceDraft, error, axisValues, onRowsChange: setRows, codePrefix, savedCodes,
  onErpItemSelect, onRegularPriceApply, erpNotice, canSearchErp = true, optionImport, structureLocked = false,
}: GoodsOptionEditorProps) {
  const firstAttributes = rows[0]?.attributes ?? {};
  const initialAxes = Object.keys(firstAttributes).map((name) => ({ name, values: [...new Set(rows.map((row) => row.attributes[name]))].join(', ') }));
  const [axes, setAxes] = useState<GoodsOptionAxis[]>(() => Array.from({ length: GOODS_OPTION_AXIS_LIMIT }, (_, i) => ({ name: axisValues?.[`optionAxisName${i}`] ?? initialAxes[i]?.name ?? '', values: axisValues?.[`optionAxisValues${i}`] ?? initialAxes[i]?.values ?? '' })));
  const single = isSingleGoodsOption(rows);
  const [optionUsage, setOptionUsage] = useState<OptionUsage>(() => {
    if (axisValues?.optionUsage === 'on' || axisValues?.optionUsage === 'off') return axisValues.optionUsage;
    return !single || axes.some((axis) => axis.name.trim() || axis.values.trim()) ? 'on' : 'off';
  });
  const [erpRows, setErpRows] = useState<Record<string, ErpRowState>>({});
  const [importOpen, setImportOpen] = useState(false), [importMessage, setImportMessage] = useState('');
  /* 옵션 없음에서 옵션을 만들면 옵션 없이 넣어 둔 재고수량은 새 옵션으로 나눠지지 않는다. 다시 넣기 쉽게 그 수량을 합계 옆에 남긴다. */
  const [previousSingleStock, setPreviousSingleStock] = useState<number | null>(null);
  const importFingerprint = JSON.stringify({ rows, baseline, basePrice, priceDraft, axes, optionUsage, accountId: optionImport?.accountId,
    target: optionImport?.target, databaseVersion: optionImport?.databaseVersion, blockedReason: optionImport?.blockedReason, pending: optionImport?.pending });
  const optionsEnabled = !single || optionUsage === 'on';
  const singleRow = single ? rows[0] : undefined;
  const stock = goodsOptionStockTotals(rows);
  /* 행 순서 번호가 아니라 서버가 실제로 붙일 번호(기존·사용 중지 옵션 코드를 피한 다음 빈 번호)를 보인다. */
  const predictedCodes = predictGoodsOptionCodes(rows, codePrefix, savedCodes);

  function update(key: string, changes: Partial<GoodsOptionRow>) {
    setRows((current) => current.map((row) => goodsOptionRowKey(row) === key ? { ...row, ...changes } : row));
  }
  async function changeOptionUsage(next: OptionUsage) {
    if (next === 'off' && !single) {
      if (!await adminConfirm({ title: `'${GOODS_OPTION_NONE_LABEL}'으로 바꿀까요?`, message: goodsOptionCollapseNotice(rows), confirmLabel: `${GOODS_OPTION_NONE_LABEL}으로 바꾸기` })) return;
      setRows((current) => collapseGoodsOptionRows(current));
      setAxes(EMPTY_AXES);
      setPreviousSingleStock(null);
    }
    setOptionUsage(next);
  }
  function selectErp(key: string, item: ErpItemMatch) {
    /* 한 ERP 품목은 옵션 하나에만 연결된다. 다른 옵션이 쓰는 품목이면 채우지도, 카테고리·판매가를 제안하지도 않는다. */
    const selection = selectErpItemForGoodsOption(rows, key, item);
    if (!selection.ok) {
      /* 입력 칸은 고른 품목의 품명을 먼저 넣는다(onChange). 품명과 ERP 코드가 다른 품목을 가리키지 않게 고르기 전 품명으로 되돌린다. */
      const previous = rows.find((row) => goodsOptionRowKey(row) === key);
      if (previous) update(key, { erpName: previous.erpName ?? null });
      setErpRows((current) => ({ ...current, [key]: { message: selection.error, warning: true } }));
      return;
    }
    setRows((current) => current.map((row) => goodsOptionRowKey(row) === key ? applyErpItemToGoodsOption(row, item) : row));
    const row = rows.find((candidate) => goodsOptionRowKey(candidate) === key);
    /* 1007-045: 판매가 칸이 비어 있으면 ERP 판매가를 바로 넣는다(값이 있으면 아래 적용 버튼만 둔다). 결과 금액 안내는 버튼과 같다. */
    if (priceDraft && onRegularPriceApply && shouldAutoFillErpSalePrice({ salePrice: item.salePrice, regularPrice: priceDraft.regularPrice, single, extraPrice: row?.extraPrice ?? 0 })) {
      const plan = planErpSalePrice({ salePrice: item.salePrice!, mode: 'single', price: priceDraft, extraPrice: single ? row?.extraPrice : undefined });
      if (plan.ok && plan.target === 'regularPrice') {
        onRegularPriceApply(plan.value);
        setErpRows((current) => ({ ...current, [key]: { item, message: `판매가가 비어 있어 ${plan.message.replace(/^판매가에 /, '')}`, warning: plan.attention } }));
        onErpItemSelect?.(item);
        return;
      }
    }
    setErpRows((current) => ({ ...current, [key]: { item } }));
    onErpItemSelect?.(item);
  }
  function changeErpName(key: string, value: string) {
    update(key, { erpName: value });
    /* 직접 고친 품명에는 이전에 고른 품목의 판매가 제안을 남기지 않는다. */
    setErpRows((current) => { if (!current[key]) return current; const next = { ...current }; delete next[key]; return next; });
  }
  function applyErpPrice(key: string, salePrice: number) {
    const price = priceDraft ?? { regularPrice: String(basePrice), discountEnabled: false, discountValue: '', discountUnit: 'won' };
    const row = rows.find((item) => goodsOptionRowKey(item) === key);
    const plan = planErpSalePrice({ salePrice, mode: single ? 'single' : 'multiple', price, extraPrice: single ? row?.extraPrice : undefined });
    const record = (message: string, warning: boolean) => setErpRows((current) => current[key] ? { ...current, [key]: { ...current[key], message, warning } } : current);
    if (!plan.ok) { record(plan.error, true); return; }
    if (plan.target === 'regularPrice') {
      if (!onRegularPriceApply) { record('판매가 칸에서 직접 입력해주세요.', true); return; }
      onRegularPriceApply(plan.value);
    } else update(key, { extraPrice: plan.value });
    /* 적용했지만 결과 금액이 ERP 판매가와 다르면(남은 옵션가·맞지 않는 할인) 확인 색으로 알린다. */
    record(plan.message, plan.attention);
  }

  return <div className="flex min-w-0 flex-col gap-5" data-option-editor="" data-option-mode={single ? 'single' : 'multiple'}>
    <section className={GOOD_SUBPANEL_CLASS} aria-label="재고수량">
      {singleRow ? <SingleStock structureLocked={structureLocked} row={singleRow} basePrice={basePrice} update={update} />
        : <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 tabular-nums">
          <span className="text-xs text-muted-foreground">옵션 재고수량 합계</span><strong className="text-base font-semibold text-foreground">{stock.total.toLocaleString('ko-KR')}개</strong>
          {stock.active !== stock.total && <small className="text-xs text-muted-foreground">사용 중인 옵션만 {stock.active.toLocaleString('ko-KR')}개</small>}
          {previousSingleStock !== null && <small className="text-xs text-[var(--wc-warning)]" data-good-option-previous-stock="" role="status">옵션을 만들기 전 재고수량 {previousSingleStock.toLocaleString('ko-KR')}개 · 옵션마다 다시 넣어 주세요</small>}
        </p>}
      {singleRow?.lowStockThreshold != null && singleRow.stockQty <= singleRow.lowStockThreshold && <p className="text-xs font-medium text-[var(--wc-warning)]" data-tone="warning" role="status">재고 부족 · 안전재고 기준 {singleRow.lowStockThreshold.toLocaleString('ko-KR')}개 이하</p>}
    </section>

    {/* 둘 중 하나를 고르면 그에 필요한 입력만 열린다('글보다 화면' 2). 폼 name·value(optionUsage on/off)는 그대로다. */}
    <GoodChoiceCards disabled={structureLocked} data-good-option-usage="" legend="옵션">
      <GoodChoiceCard name="optionUsage" value="off" checked={!optionsEnabled} onChange={() => void changeOptionUsage('off')} title={GOODS_OPTION_NONE_LABEL} description="한 가지로만 파는 상품" />
      <GoodChoiceCard name="optionUsage" value="on" checked={optionsEnabled} onChange={() => void changeOptionUsage('on')} title="옵션 있음" description="색상·사이즈처럼 골라서 사는 상품" />
    </GoodChoiceCards>

    {!structureLocked && optionImport && optionsEnabled && <div className="flex min-w-0 flex-col items-start gap-2" data-good-option-import="">
      <button type="button" className={buttonVariants({ variant: 'outline' })} data-slot="button" disabled={optionImport.pending || Boolean(optionImport.blockedReason)} onClick={() => { setImportMessage(''); setImportOpen(true); }}>다른 상품 옵션 불러오기</button>
      {optionImport.blockedReason && <p className="text-sm text-muted-foreground">{optionImport.blockedReason}</p>}
      {importMessage && <p className="text-sm text-foreground" role="status">{importMessage}</p>}
    </div>}
    {importOpen && optionImport && <GoodsOptionImportPicker context={optionImport} categories={optionImport.categories} currentRows={goodsOptionRowsForImport(rows)} basePrice={basePrice} fingerprint={importFingerprint}
      onClose={() => setImportOpen(false)} onApply={(plan, expected) => {
        if (optionImport.pending || optionImport.blockedReason || expected !== importFingerprint) return false;
        setRows(emptyNewGoodsOptionStock(plan.rows, rows)); setAxes(Array.from({ length: GOODS_OPTION_AXIS_LIMIT }, (_, index) => plan.axes[index] ?? { name: '', values: '' }));
        setOptionUsage('on'); setErpRows({});
        setPreviousSingleStock(null);
        setImportMessage(plan.added ? `옵션을 불러왔습니다. 새 옵션 ${plan.added}개에 재고수량을 넣고 상품을 저장해야 반영됩니다.` : '옵션을 불러왔습니다. 상품을 저장해야 반영됩니다.');
        optionImport.onApplied(); return true;
      }} />}

    <fieldset disabled={structureLocked} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0"><OptionInputs axes={axes} rows={rows} hidden={!optionsEnabled} setAxes={setAxes} setRows={setRows} onCreatedFromSingle={setPreviousSingleStock} />
    {optionsEnabled && (single
      ? <p className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground" data-good-option-empty="" role="status">아직 만든 옵션이 없습니다. 지금 저장하면 옵션 없는 상품으로 저장됩니다.</p>
      : <OptionList rows={rows} basePrice={basePrice} update={update} setRows={setRows} />)}</fieldset>

    <OptionDetailTable rows={rows} single={single} predictedCodes={predictedCodes} savedCodes={savedCodes} update={update} erpRows={erpRows} onErpChange={changeErpName}
      onErpSelect={selectErp} onErpPrice={applyErpPrice} notice={erpNotice} canSearchErp={canSearchErp} structureLocked={structureLocked} />
    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    {rows.every((row) => row.isActive === false) && <p className="text-sm font-medium text-[var(--wc-warning)]" role="status">모든 옵션이 사용 중지되어 고객이 구매할 수 없습니다.</p>}
    <input type="hidden" name="variants" value={JSON.stringify(rows)} readOnly />
    <input type="hidden" name="variantBaseline" value={JSON.stringify(baseline)} readOnly />
  </div>;
}
