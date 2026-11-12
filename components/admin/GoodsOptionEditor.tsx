'use client';

import { useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { ArrowDown, ArrowUp, ChevronRight } from 'lucide-react';
import type { ErpItemMatch } from '@/lib/admin/erp-items';
import {
  applyErpItemToGoodsOption, applyGoodsOptionBulkEdit, collapseGoodsOptionRows, generateGoodsOptionRows, goodsOptionCollapseNotice, goodsOptionRowKey,
  goodsOptionStockTotals, isSingleGoodsOption, parseGoodsOptionBulkEdit, predictGoodsOptionCodes, removeGoodsOptionRows, selectErpItemForGoodsOption,
  emptyNewGoodsOptionStock, goodsOptionRowsForImport, shouldAutoFillErpSalePrice, GOODS_OPTION_AXIS_LIMIT, GOODS_OPTION_ROW_LIMIT, GOODS_OPTION_STOCK_REQUIRED,
  type GoodsOptionAxis, type GoodsOptionBulkInput, type GoodsOptionRow, type GoodsOptionSavedCodes,
} from '@/lib/admin/goods-option-editor';
import { formatWon, planErpSalePrice, type GoodsPriceDraft } from '@/lib/admin/goods-price-editor';
import { ADMIN_VOCABULARY } from '@/lib/admin/vocabulary';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/admin/kit/ui/table';
import { AdminField } from './console/AdminKit';
import { ErpItemNameInput } from './ErpItemNameInput';
import { GOOD_INPUT_CLASS, GOOD_NUMBER_INPUT_CLASS, GOOD_SUBPANEL_CLASS, GOOD_TABLE_FRAME_CLASS, GoodAmountField, GoodChoiceGroup } from './GoodEditorParts';
import { GoodsOptionImportPicker } from './GoodsOptionImportDialog';
import { GoodWorkspaceDetails } from './GoodWorkspace';
import type { GoodsOptionImportContext } from '@/lib/admin/goods-option-import';
import { adminConfirm } from '@/lib/admin/confirm';

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
  /** 저장할 상품코드(입력값 또는 제안값). 빈 관리코드에 붙을 코드의 앞부분이다. */
  codePrefix?: string;
  /**
   * 저장된 상품코드와 이 상품의 저장된 옵션 전체(보관 포함). 빈 관리코드 칸에 저장 시 붙을 코드를 보이는 근거다.
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
const STOCK_GUIDANCE = 'ICONS에서 판매할 수량이며 주문하면 차감됩니다. 비워 두면 저장되지 않으니 재고가 없으면 0을 입력합니다. 안전재고는 부족 알림 기준입니다.';
const AUTO_CODE = '저장 시 자동 생성';

/* 템플릿 룩(ADR-0028). 옵션 사용 라디오는 GoodChoiceOption과 같은 모양을 직접 그린다 — 불러오기 테스트가 이 컴포넌트의
   반환 트리에서 네이티브 라디오(input)를 찾는다. */
const CHOICE_LABEL_CLASS = 'inline-flex min-h-8 cursor-pointer items-center gap-2 text-sm text-foreground has-disabled:cursor-not-allowed has-disabled:opacity-50';
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
 */
function StockQtyInput({ value, onChange, ...props }: { value: number; onChange: (value: number) => void; id?: string; 'aria-label'?: string; className?: string }) {
  const empty = !Number.isFinite(value);
  return <input {...props} data-slot="input" aria-describedby="goods-option-stock-guidance" value={empty ? '' : value} min={0} step={1} type="number" required placeholder="숫자 입력"
    ref={(input) => { input?.setCustomValidity(empty ? GOODS_OPTION_STOCK_REQUIRED : ''); }}
    onChange={(event) => onChange(event.target.value === '' ? Number.NaN : Number(event.target.value))} />;
}

function OptionDetailTable({ rows, single, predictedCodes, update, erpRows, onErpChange, onErpSelect, onErpPrice, notice, canSearchErp, structureLocked }: {
  rows: GoodsOptionRow[];
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
  /* 펼침 상태는 저장 시도 뒤에도 유지한다(R14). */
  return <GoodWorkspaceDetails stateId="good-option-details" className="group/option-details min-w-0 rounded-lg border" data-good-option-details="">
    <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium outline-none select-none group-open/option-details:rounded-b-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
      <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-open/option-details:rotate-90 motion-reduce:transition-none" />
      옵션 상세 정보 · 관리코드·ERP 품명·ERP 코드·바코드·안전재고
    </summary>
    <div className="flex min-w-0 flex-col gap-3 border-t p-3">
      <p id="goods-option-external-identity-guidance" className="text-sm text-muted-foreground">
        ERP 품명을 입력해 반입된 ERP 품목을 고르면 ERP 코드·바코드를 채우고 카테고리·판매가를 제안합니다. ERP 코드·바코드는 관리코드와 따로 저장하며 선행 0을 유지합니다. 비워 두면 미설정입니다. 관리코드는 ICONS 자체 옵션코드이고 비워 두면 저장할 때 만듭니다.
      </p>
      <div className={GOOD_TABLE_FRAME_CLASS} role="region" aria-label="옵션 ERP 정보와 안전재고 상세" tabIndex={0}>
        <Table className="min-w-[58rem] table-fixed">
          <TableCaption className="sr-only">옵션별 관리코드·ERP 품명·ERP 코드·바코드·안전재고 기준</TableCaption>
          <TableHeader className="bg-muted/50"><TableRow className="hover:bg-transparent">
            <TableHead scope="col" className={`w-[15%] ${TABLE_HEAD_CLASS}`}>옵션</TableHead>
            <TableHead scope="col" className={`w-[17%] ${TABLE_HEAD_CLASS}`}>{ADMIN_VOCABULARY.optionCode}</TableHead>
            <TableHead scope="col" className={`w-[23%] ${TABLE_HEAD_CLASS}`}>ERP 품명</TableHead>
            <TableHead scope="col" className={`w-[14%] ${TABLE_HEAD_CLASS}`}>ERP 코드</TableHead>
            <TableHead scope="col" className={`w-[17%] ${TABLE_HEAD_CLASS}`}>바코드</TableHead>
            <TableHead scope="col" className={`w-[14%] ${TABLE_HEAD_CLASS}`}>안전재고 기준</TableHead>
          </TableRow></TableHeader>
          <TableBody>{rows.map((row, index) => {
            const key = goodsOptionRowKey(row);
            const erp = erpRows[key];
            const erpSalePrice = erp?.item?.salePrice ?? null;
            const tone = erp?.warning ? 'warning' : 'success';
            return <TableRow key={key} data-variant-id={row.id ?? undefined}>
              <TableCell className={`${TABLE_CELL_CLASS} wrap-anywhere`}>{single
                ? <input className={GOOD_INPUT_CLASS} data-slot="input" readOnly={structureLocked} aria-label="기본 옵션명" value={row.name} maxLength={200} onChange={(event) => update(key, { name: event.target.value })} />
                : row.name || `옵션 ${index + 1}`}</TableCell>
              <TableCell className={TABLE_CELL_CLASS}><input className={GOOD_INPUT_CLASS} data-slot="input" id={single ? 'goods-single-code' : undefined} aria-label={single ? '기본 옵션 관리코드' : `옵션 ${index + 1} 관리코드`} value={row.code} maxLength={120} placeholder={predictedCodes[index] ?? AUTO_CODE} onChange={(event) => update(key, { code: event.target.value })} /></TableCell>
              <TableCell className={TABLE_CELL_CLASS}>
                {canSearchErp ? <ErpItemNameInput value={row.erpName ?? ''} onChange={(value) => onErpChange(key, value)} onSelect={(item) => onErpSelect(key, item)}
                  ariaLabel={`옵션 ${index + 1} ERP 품명`} ariaDescribedBy="goods-option-external-identity-guidance" maxLength={200} placeholder="미설정" /> : <input className={GOOD_INPUT_CLASS} data-slot="input" aria-label={`옵션 ${index + 1} ERP 품명`} value={row.erpName ?? ''} onChange={event => onErpChange(key, event.target.value)} maxLength={200} placeholder="미설정" />}
                {erpSalePrice !== null && <button type="button" className={`${buttonVariants({ variant: 'outline', size: 'xs' })} mt-1.5 h-auto min-h-6 whitespace-normal`} data-slot="button" onClick={() => onErpPrice(key, erpSalePrice)}>
                  ERP 판매가 {formatWon(erpSalePrice)} 적용
                </button>}
                {erp?.message && <small role="status" className={ERP_MESSAGE_CLASS[tone]} data-good-option-erp-message="" data-tone={tone}>{erp.message}</small>}
              </TableCell>
              <TableCell className={TABLE_CELL_CLASS}><input className={GOOD_INPUT_CLASS} data-slot="input" aria-label={`옵션 ${index + 1} ERP 코드`} aria-describedby="goods-option-external-identity-guidance" value={row.erpCode ?? ''} maxLength={120} placeholder="미설정" onChange={(event) => update(key, { erpCode: event.target.value })} /></TableCell>
              <TableCell className={TABLE_CELL_CLASS}><input className={GOOD_INPUT_CLASS} data-slot="input" aria-label={`옵션 ${index + 1} 바코드`} aria-describedby="goods-option-external-identity-guidance" value={row.barcode ?? ''} maxLength={120} placeholder="미설정" onChange={(event) => update(key, { barcode: event.target.value })} /></TableCell>
              <TableCell className={TABLE_CELL_CLASS}>
                <input className={GOOD_NUMBER_INPUT_CLASS} data-slot="input" aria-label={`옵션 ${index + 1} 안전재고 기준`} aria-describedby="goods-option-stock-guidance" value={row.lowStockThreshold ?? ''} min={0} max={2147483647} step={1} type="number" placeholder="미설정" onChange={(event) => update(key, { lowStockThreshold: event.target.value === '' ? null : Number(event.target.value) })} />
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

function OptionInputs({ axes, rows, hidden, setAxes, setRows }: {
  axes: GoodsOptionAxis[];
  rows: GoodsOptionRow[];
  hidden: boolean;
  setAxes: Dispatch<SetStateAction<GoodsOptionAxis[]>>;
  setRows: Dispatch<SetStateAction<GoodsOptionRow[]>>;
}) {
  const [generationError, setGenerationError] = useState('');
  /* 세 번째 옵션명은 드물게 쓴다. 입력은 DOM에 남겨 두고(저장·복구가 같은 이름을 읽는다) 값이 있거나 옵션 추가를 누를 때만 보인다. */
  const [extraAxisOpen, setExtraAxisOpen] = useState(false);
  const extraAxisShown = extraAxisOpen || axes.slice(2).some((axis) => axis.name.trim() || axis.values.trim());
  return <section className={GOOD_SUBPANEL_CLASS} aria-labelledby="goods-option-inputs-title" data-good-option-inputs="" hidden={hidden}>
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h5 id="goods-option-inputs-title" className="text-sm leading-snug font-medium text-foreground">옵션 입력</h5>
      <span className="text-xs text-muted-foreground">옵션명 최대 {GOODS_OPTION_AXIS_LIMIT}개 · 옵션 최대 {GOODS_OPTION_ROW_LIMIT}개</span>
    </div>
    {axes.map((axis, index) => <div className="grid min-w-0 gap-x-4 gap-y-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]" hidden={index >= 2 && !extraAxisShown} key={index}>
      <AdminField inputId={`option-axis-${index}`} label={`옵션명 ${index + 1}${index ? ' (선택)' : ''}`}>
        <input className={GOOD_INPUT_CLASS} data-slot="input" id={`option-axis-${index}`} name={`optionAxisName${index}`} value={axis.name} maxLength={40} placeholder={['예: 색상', '예: 사이즈', '예: 구성'][index]} onChange={(event) => setAxes((old) => old.map((item, i) => i === index ? { ...item, name: event.target.value } : item))} />
      </AdminField>
      <AdminField inputId={`option-values-${index}`} label={`옵션값 ${index + 1} (쉼표로 구분)`}>
        <input className={GOOD_INPUT_CLASS} data-slot="input" id={`option-values-${index}`} name={`optionAxisValues${index}`} value={axis.values} placeholder={['예: 빨강, 파랑', '예: S, M, L', '예: 기본, 선물포장'][index]} onChange={(event) => setAxes((old) => old.map((item, i) => i === index ? { ...item, values: event.target.value } : item))} />
      </AdminField>
    </div>)}
    {extraAxisShown ? null : <button type="button" className={`${buttonVariants({ variant: 'ghost', size: 'sm' })} self-start`} data-slot="button" onClick={() => setExtraAxisOpen(true)}>옵션 추가</button>}
    <p className="text-sm text-muted-foreground">
      이미 있는 조합의 옵션가·재고수량·관리코드·ERP 정보는 그대로 둡니다. 목록에서 빠진 조합은 저장할 때 지워지며, 주문·장바구니에 쓰인 옵션은 삭제 대신 보관됩니다.
    </p>
    <button type="button" className={`${buttonVariants({ variant: 'outline' })} self-start`} data-slot="button" onClick={() => {
      const result = generateGoodsOptionRows(axes.filter((axis, i) => i === 0 || axis.name.trim() || axis.values.trim()), rows);
      if (!result.ok) { setGenerationError(result.error); return; }
      setRows(result.rows); setGenerationError('');
    }}>옵션목록으로 적용</button>
    {generationError && <p className="text-sm text-destructive" role="alert">{generationError}</p>}
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
  function removeSelected() {
    const result = removeGoodsOptionRows(rows, selected);
    if (!result.ok) { setBulkMessage({ text: result.error, failed: true }); return; }
    setRows(result.rows); setChecked(new Set());
    setBulkMessage({ text: `옵션 ${selected.size}개를 목록에서 뺐습니다. 주문·장바구니에 쓰인 옵션은 저장할 때 삭제 대신 보관됩니다.`, failed: false });
  }
  const bulkTone = bulkMessage?.failed ? 'warning' : 'success';
  return <section className={GOOD_SUBPANEL_CLASS} aria-labelledby="goods-option-list-title">
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h5 id="goods-option-list-title" className="text-sm leading-snug font-medium text-foreground">옵션목록 (총 {rows.length.toLocaleString('ko-KR')}개)</h5>
      <span className="text-xs text-muted-foreground">옵션가는 판매가(할인하면 할인가)에 더하는 금액입니다.</span>
    </div>
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
          <option value="">변경 안 함</option><option value="active">사용</option><option value="stopped">중지</option>
        </NativeSelect>
      </div>
      <button type="button" className={buttonVariants({ variant: 'outline' })} data-slot="button" disabled={!selected.size} onClick={applyBulk}>선택목록 일괄수정</button>
      <button type="button" className={buttonVariants({ variant: 'outline' })} data-slot="button" disabled={!selected.size} onClick={removeSelected}>선택삭제</button>
    </div>
    {bulkMessage && <p className={bulkTone === 'warning' ? 'text-xs text-[var(--wc-warning)]' : 'text-xs text-[var(--wc-success)]'} data-tone={bulkTone} role="status">{bulkMessage.text}</p>}
    <div className={GOOD_TABLE_FRAME_CLASS} data-good-option-list="" role="region" aria-label="옵션목록 편집표" tabIndex={0}>
      {/* 7개 열은 좁은 화면에서 줄이지 않고 표 영역 안에서 가로로 이동한다. 관리코드는 옵션 상세 정보에 있다. */}
      <Table className="min-w-[46rem] table-fixed">
        <TableCaption className="sr-only">선택·옵션명·옵션가·재고수량·사용여부·순서·삭제</TableCaption>
        <TableHeader className="bg-muted/50"><TableRow className="hover:bg-transparent">
          <TableHead scope="col" className={`w-12 text-center ${TABLE_HEAD_CLASS}`}><span className="sr-only">선택</span></TableHead>
          <TableHead scope="col" className={`w-[30%] ${TABLE_HEAD_CLASS}`}>옵션명</TableHead>
          <TableHead scope="col" className={`w-[18%] ${TABLE_HEAD_CLASS}`}>{ADMIN_VOCABULARY.optionPrice}</TableHead>
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
              {row.isActive === false && <small className="mt-1 block text-xs text-[var(--wc-warning)]">사용 중지 · 주문 기록과 재고 보존</small>}
            </TableCell>
            <TableCell className={TABLE_CELL_CLASS}>
              <input className={GOOD_NUMBER_INPUT_CLASS} data-slot="input" aria-label={`옵션 ${index + 1} 옵션가`} value={row.extraPrice} min={0} step={1} type="number" onChange={(event) => update(key, { extraPrice: wholeNumber(event.target.value) })} />
              <small className="mt-1 block text-[11px] text-muted-foreground tabular-nums">판매 {formatWon(basePrice + (Number.isFinite(row.extraPrice) ? row.extraPrice : 0))}</small>
            </TableCell>
            <TableCell className={TABLE_CELL_CLASS}><StockQtyInput className={GOOD_NUMBER_INPUT_CLASS} aria-label={`옵션 ${index + 1} 재고수량`} value={row.stockQty} onChange={(stockQty) => update(key, { stockQty })} /></TableCell>
            <TableCell className={TABLE_CELL_CLASS}><NativeSelect className="w-full" aria-label={`옵션 ${index + 1} 사용여부`} value={row.isActive === false ? 'stopped' : 'active'} onChange={(event) => update(key, { isActive: event.target.value === 'active' })}>
              <option value="active">사용</option><option value="stopped">중지</option>
            </NativeSelect></TableCell>
            <TableCell className={TABLE_CELL_CLASS}><div className="flex flex-wrap gap-1">
              <button type="button" className={buttonVariants({ variant: 'outline', size: 'icon-sm' })} data-slot="button" aria-label={`옵션 ${index + 1} 위로`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp aria-hidden="true" /></button>
              <button type="button" className={buttonVariants({ variant: 'outline', size: 'icon-sm' })} data-slot="button" aria-label={`옵션 ${index + 1} 아래로`} disabled={index === rows.length - 1} onClick={() => move(index, 1)}><ArrowDown aria-hidden="true" /></button>
            </div></TableCell>
            <TableCell className={TABLE_CELL_CLASS}><button type="button" className={buttonVariants({ variant: 'destructive', size: 'sm' })} data-slot="button" aria-label={`옵션 ${index + 1} 삭제`} disabled={rows.length === 1} onClick={() => setRows((current) => current.filter((item) => goodsOptionRowKey(item) !== key))}>삭제</button></TableCell>
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
  /* 사용여부도 같다. 중지된 기본 옵션만 남은 상품은 여기서 되돌린다. */
  const [activeVisible, setActiveVisible] = useState(false);
  return <div className="grid min-w-0 items-start gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
    <AdminField inputId="goods-single-stock" label="재고수량 (필수)">
      <GoodAmountField unit="개">
        <StockQtyInput className={GOOD_NUMBER_INPUT_CLASS} id="goods-single-stock" value={row.stockQty} onChange={(stockQty) => update(key, { stockQty })} />
      </GoodAmountField>
    </AdminField>
    {(extraVisible || row.extraPrice !== 0) && <AdminField inputId="goods-single-extra-price" label="기본 옵션 옵션가" hint="판매가(할인하면 할인가)에 더하는 금액입니다. 0원이면 판매가 그대로 판매합니다.">
      <GoodAmountField unit="원">
        <input className={GOOD_NUMBER_INPUT_CLASS} data-slot="input" id="goods-single-extra-price" aria-describedby="goods-single-extra-price-hint" value={row.extraPrice} min={0} step={1} type="number" onChange={(event) => { setExtraVisible(true); update(key, { extraPrice: wholeNumber(event.target.value) }); }} />
      </GoodAmountField>
      <small className="text-xs text-muted-foreground tabular-nums">판매 {formatWon(basePrice + (Number.isFinite(row.extraPrice) ? row.extraPrice : 0))}</small>
    </AdminField>}
    {(activeVisible || row.isActive === false) && <AdminField inputId="goods-single-active" label="기본 옵션 사용여부" hint="중지하면 고객이 구매할 수 없습니다. 주문 기록과 재고는 보존됩니다.">
      <NativeSelect className="w-full sm:max-w-xs" disabled={structureLocked} id="goods-single-active" aria-describedby="goods-single-active-hint" value={row.isActive === false ? 'stopped' : 'active'}
        onChange={(event) => { setActiveVisible(true); update(key, { isActive: event.target.value === 'active' }); }}>
        <option value="active">사용</option><option value="stopped">중지</option>
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
  const importFingerprint = JSON.stringify({ rows, baseline, basePrice, priceDraft, axes, optionUsage, accountId: optionImport?.accountId,
    target: optionImport?.target, databaseVersion: optionImport?.databaseVersion, blockedReason: optionImport?.blockedReason, pending: optionImport?.pending });
  const optionsEnabled = !single || optionUsage === 'on';
  const singleRow = single ? rows[0] : undefined;
  const stock = goodsOptionStockTotals(rows);
  /* 행 순서 번호가 아니라 서버가 실제로 붙일 번호(기존·보관 옵션 코드를 피한 다음 빈 번호)를 보인다. */
  const predictedCodes = predictGoodsOptionCodes(rows, codePrefix, savedCodes);

  function update(key: string, changes: Partial<GoodsOptionRow>) {
    setRows((current) => current.map((row) => goodsOptionRowKey(row) === key ? { ...row, ...changes } : row));
  }
  async function changeOptionUsage(next: OptionUsage) {
    if (next === 'off' && !single) {
      if (!await adminConfirm(goodsOptionCollapseNotice(rows))) return;
      setRows((current) => collapseGoodsOptionRows(current));
      setAxes(EMPTY_AXES);
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
          {stock.active !== stock.total && <small className="text-xs text-muted-foreground">사용 중 옵션 {stock.active.toLocaleString('ko-KR')}개</small>}
          <small className="text-xs text-muted-foreground">옵션목록에서 옵션별로 입력합니다.</small>
        </p>}
      <p id="goods-option-stock-guidance" className="text-xs text-muted-foreground">{STOCK_GUIDANCE}</p>
      {singleRow?.lowStockThreshold != null && singleRow.stockQty <= singleRow.lowStockThreshold && <p className="text-xs font-medium text-[var(--wc-warning)]" data-tone="warning" role="status">재고 부족 · 안전재고 기준 {singleRow.lowStockThreshold.toLocaleString('ko-KR')}개 이하</p>}
    </section>

    <GoodChoiceGroup disabled={structureLocked} data-good-option-usage="" legend="옵션">
      <label className={CHOICE_LABEL_CLASS}><input type="radio" name="optionUsage" value="on" checked={optionsEnabled} onChange={() => changeOptionUsage('on')} />설정함</label>
      <label className={CHOICE_LABEL_CLASS}><input type="radio" name="optionUsage" value="off" checked={!optionsEnabled} onChange={() => changeOptionUsage('off')} />설정안함</label>
      <span className="basis-full text-xs text-muted-foreground">색상·사이즈처럼 고객이 골라 사는 상품이면 설정합니다. 설정안함은 옵션 선택 없이 판매합니다.</span>
    </GoodChoiceGroup>

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
        setImportMessage(plan.added ? `옵션 초안을 적용했습니다. 새 옵션 ${plan.added}개는 재고수량을 입력한 뒤 상품을 저장해야 반영됩니다.` : '옵션 초안을 적용했습니다. 상품을 저장해야 반영됩니다.');
        optionImport.onApplied(); return true;
      }} />}

    <fieldset disabled={structureLocked} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0"><OptionInputs axes={axes} rows={rows} hidden={!optionsEnabled} setAxes={setAxes} setRows={setRows} />
    {optionsEnabled && (single
      ? <p className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground" role="status">옵션목록 (총 0개) · 옵션명과 옵션값을 입력하고 옵션목록으로 적용을 누르세요. 적용 전에는 옵션 없이 판매하는 상품으로 저장됩니다.</p>
      : <OptionList rows={rows} basePrice={basePrice} update={update} setRows={setRows} />)}</fieldset>

    <OptionDetailTable rows={rows} single={single} predictedCodes={predictedCodes} update={update} erpRows={erpRows} onErpChange={changeErpName}
      onErpSelect={selectErp} onErpPrice={applyErpPrice} notice={erpNotice} canSearchErp={canSearchErp} structureLocked={structureLocked} />
    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    {rows.every((row) => row.isActive === false) && <p className="text-sm font-medium text-[var(--wc-warning)]" role="status">모든 옵션이 사용 중지되어 고객이 구매할 수 없습니다.</p>}
    <input type="hidden" name="variants" value={JSON.stringify(rows)} readOnly />
    <input type="hidden" name="variantBaseline" value={JSON.stringify(baseline)} readOnly />
  </div>;
}
