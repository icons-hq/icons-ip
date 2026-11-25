'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Copy, ListChecks } from 'lucide-react';
import { findGoodNoticePresets, loadGoodNoticeOf } from '@/app/admin/good-notice-actions';
import { searchGoodsOptionImportAction } from '@/app/admin/goods-option-import-actions';
import { AdminHelpTip } from '@/components/admin/console/AdminHelpTip';
import { AdminPickerDialog, type AdminPickerRowView } from '@/components/admin/console/AdminPickerDialog';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { adminConfirm } from '@/lib/admin/confirm';
import { SUGGEST_LOOKUP_FAILED, suggestNoticePresetByNames } from '@/lib/admin/good-notice-suggestion';
import { GOODS_NOTICE_PRESET_PAGE_SIZE, GOODS_NOTICE_PRESETS_PATH, type GoodsKcPresetTemplate, type GoodsNoticePresetPageData } from '@/lib/admin/goods-notice-presets';
import { GOOD_EDITOR_HELP } from '@/lib/admin/help/good-editor';
import { GOOD_EDITOR_B7_HELP } from '@/lib/admin/help/good-editor-b7';
import type { AdminPickerLoader } from '@/lib/admin/picker';
import { GOODS_NOTICE_FIELDS, type GoodsNoticeField, type GoodsNoticeInfo, type GoodsNoticeKey } from '@/lib/goods-notice';
import { AdminGoodsPicker, type AdminGoodsPickerRow } from './AdminGoodsPicker';

type Preset = GoodsNoticePresetPageData['presets'][number];
/** 가져올 7칸. 템플릿은 칸을 비워 둘 수 있어 빈 값(빈 문자열·null·없음)이 올 수 있다. */
type NoticeSource = Partial<Record<GoodsNoticeKey, string | null>>;
/** 폼에 지금 적혀 있는 7칸(없는 칸은 빈 문자열). */
export type NoticeFormValues = Record<GoodsNoticeKey, string>;
type NoticeForm = { elements: { namedItem(name: string): unknown } };

const NO_NAMES: readonly string[] = [];
const FIELD_COUNT = GOODS_NOTICE_FIELDS.length;
const EMPTY_NOTICE_MESSAGE = '이 상품에는 적어 둔 상품정보제공고시가 없습니다. 다른 상품을 골라 주세요.';
/* 비워 둔 칸이 있는 템플릿은 지금 값을 읽어야 그 칸을 그대로 둘 수 있다. 읽지 못하면 값을 지우지 않게 가져오지 않는다. */
const FORM_UNREADABLE_MESSAGE = '지금 적어 둔 값을 읽지 못해 가져오지 않았습니다. 화면을 새로고침한 뒤 다시 가져와 주세요.';
const KC_MESSAGE = ' KC 정보에도 유형 틀이 들어갑니다. 모델·옵션·번호·사업자는 직접 입력해주세요.';

/** 템플릿 선택창의 조회. 서버가 이미 20개씩 나눠 준다. */
const loadNoticePresets: AdminPickerLoader<Preset> = async (request) => {
  const result = await findGoodNoticePresets(request.query, request.page);
  if ('error' in result) return { error: result.error };
  return { rows: result.presets, total: result.total, page: result.filters.page, pageSize: GOODS_NOTICE_PRESET_PAGE_SIZE };
};

/**
 * [다른 상품에서 복사] 선택창의 조회(화면 규칙 2). 같은 상품 검색에 "고시를 한 칸이라도 적어 둔 상품만"과
 * "지금 편집 중인 상품 제외"를 건다 — 고를 수 없는 상품은 목록에 넣지 않아 총 개수와 페이지가 맞는다.
 */
export function noticeSourceLoader(excludeGoodId?: string | null): AdminPickerLoader<AdminGoodsPickerRow> {
  return async (request) => {
    const result = await searchGoodsOptionImportAction({ query: request.query, field: request.field || 'name', categoryId: request.filter, page: request.page,
      noticeSourcesOnly: true, ...(excludeGoodId ? { excludeGoodId } : {}) });
    return result.ok ? result.data : { error: result.error };
  };
}

const clip = (text: string) => { const chars = [...text.trim()]; return chars.length > 24 ? `${chars.slice(0, 24).join('')}…` : chars.join(''); };
const isBlank = (value: string | null | undefined) => !value?.trim();
const labels = (fields: readonly GoodsNoticeField[]) => fields.map((field) => field.label).join(', ');

/** 템플릿 한 줄: 이름 아래에 제조사·소재와 KC 유형 틀이 들어 있는지를 보여 이름만으로 고르지 않게 한다. KC 틀은 가져오는 화면에서만 말한다. */
export function noticePresetRowView(preset: Preset, withKcTemplate: boolean): AdminPickerRowView {
  const { maker, material } = preset.notice;
  const parts = [maker?.trim() ? `제조사 ${clip(maker)}` : '', material?.trim() ? `소재 ${clip(material)}` : '', withKcTemplate && preset.kcTemplate ? 'KC 유형 틀 포함' : ''].filter(Boolean);
  return { title: preset.name, meta: parts.join(' · ') || undefined };
}

/** 7칸이 모두 비었는가(공백만 있어도 빈 것). */
export const noticeIsBlank = (notice: NoticeSource) => GOODS_NOTICE_FIELDS.every((field) => isBlank(notice[field.key]));

/** 폼에 지금 적혀 있는 고시정보 7칸. 칸 이름(formName)으로 읽는다. 폼을 못 찾으면 null. */
export function noticeFormValues(form: NoticeForm | null | undefined): NoticeFormValues | null {
  if (!form) return null;
  return Object.fromEntries(GOODS_NOTICE_FIELDS.map((field) => {
    const value = (form.elements.namedItem(field.formName) as { value?: unknown } | null)?.value;
    return [field.key, typeof value === 'string' ? value : ''];
  })) as NoticeFormValues;
}

/** 가져오면 7칸이 어떻게 되는지. 확인창과 결과 문장이 같은 계산을 쓴다. */
export interface NoticeApplyPlan {
  /** 폼에 넣을 7칸. 그대로 두는 칸에는 지금 값이 들어 있다. */
  notice: GoodsNoticeInfo;
  /** 가져온 값이 들어가는 칸. */
  applied: GoodsNoticeField[];
  /** 가져올 쪽에 비어 있어 지금 값을 그대로 두는 칸(템플릿). */
  kept: GoodsNoticeField[];
  /** 지금 적어 둔 값이 가져온 값으로 바뀌는 칸. 같은 값이면 넣지 않는다. */
  replaced: GoodsNoticeField[];
  /** 지금 적어 둔 값이 지워지는 칸(다른 상품에서 복사할 때 그 상품에 비어 있는 칸). */
  cleared: GoodsNoticeField[];
}

/**
 * 7칸을 가져오는 계획. `keepBlank`(템플릿)면 가져올 쪽에 비어 있는 칸은 지금 값을 건드리지 않는다 —
 * 크기 · 중량·제조연월처럼 상품마다 다른 칸을 템플릿에서 비워 두면 상품에 적어 둔 값이 남는다.
 * 다른 상품에서 복사는 7칸을 그대로 옮긴다(그 상품에 비어 있는 칸은 비운다).
 */
export function planNoticeApply(source: NoticeSource, current: NoticeFormValues, keepBlank: boolean): NoticeApplyPlan {
  const plan: NoticeApplyPlan = { notice: { ...current }, applied: [], kept: [], replaced: [], cleared: [] };
  for (const field of GOODS_NOTICE_FIELDS) {
    const next = source[field.key] ?? null, now = current[field.key];
    if (keepBlank && isBlank(next)) { plan.kept.push(field); continue; }
    plan.notice[field.key] = next;
    plan.applied.push(field);
    if (isBlank(now) || now.trim() === (next ?? '').trim()) continue;
    (isBlank(next) ? plan.cleared : plan.replaced).push(field);
  }
  return plan;
}

/** 확인창 문장: 적어 둔 값이 실제로 바뀌는 칸만 말한다. */
export function noticeReplaceMessage(sourceName: string, plan: NoticeApplyPlan): string {
  const parts: string[] = [];
  if (plan.replaced.length) parts.push(plan.replaced.length === FIELD_COUNT
    ? `지금 적어 둔 ${FIELD_COUNT}개 칸이 모두 ‘${sourceName}’ 내용으로 바뀝니다.`
    : `지금 적어 둔 ${labels(plan.replaced)} 칸이 ‘${sourceName}’ 내용으로 바뀝니다.`);
  if (plan.cleared.length) parts.push(`‘${sourceName}’에 비어 있는 ${labels(plan.cleared)} 칸은 지금 적어 둔 값이 지워집니다.`);
  return parts.join(' ');
}

/** 템플릿을 가져온 뒤의 결과 문장: 몇 칸을 가져왔고 어느 칸을 그대로 뒀는지. `plan`이 없으면(폼을 못 읽음) 7칸을 모두 가져온 경우다. */
export function noticePresetAppliedMessage(presetName: string, plan: NoticeApplyPlan | null): string {
  if (!plan || !plan.kept.length) return `‘${presetName}’ 템플릿의 ${FIELD_COUNT}개 칸을 가져왔습니다.`;
  if (!plan.applied.length) return `‘${presetName}’ 템플릿에는 적어 둔 칸이 없어 ${FIELD_COUNT}개 칸을 그대로 두었습니다.`;
  return `‘${presetName}’ 템플릿에서 ${plan.applied.length}개 칸을 가져왔습니다. 템플릿에 비어 있는 ${labels(plan.kept)} 칸은 그대로 두었습니다.`;
}

/*
 * 고시정보 7칸을 다른 곳에서 가져오는 두 버튼. 템플릿 목록과 상품 목록은 모두 공용 선택창에서 고른다(화면 규칙 1).
 * 상품 폼 안에 놓이므로 버튼은 모두 type="button"이다. 선택창은 body로 포털돼 폼 밖에서 열린다.
 * 대표 카테고리 이름에 맞는 템플릿은 제안만 한다 — 고시는 법정 표시라 사람이 누를 때만 적용한다.
 * 템플릿은 적혀 있는 칸만 가져온다. 템플릿에서 비워 둔 칸은 상품에 적어 둔 값을 건드리지 않는다(부르는 쪽은 7칸을 모두 받아 쓰므로 그 칸에는 지금 값을 실어 준다).
 * 적어 둔 값이 바뀌거나 지워지는 칸이 있을 때만 그 칸을 말하며 확인한다(화면 규칙 7). 칸 값은 props에 없어 폼의 칸 이름으로 읽는다.
 */
export function GoodNoticePicker({ onApply, readOnly=false, copyKcTemplate=true, suggestNames=NO_NAMES, excludeGoodId }: {
  onApply: (notice: GoodsNoticeInfo, kcTemplate?:GoodsKcPresetTemplate|null) => void;readOnly?:boolean;copyKcTemplate?:boolean;
  /** 대표 카테고리 이름(말단 → 위로). 앞에서부터 템플릿이 있는 첫 이름으로 제안한다. 비어 있으면 제안하지 않는다. */
  suggestNames?: readonly string[];
  /** 지금 편집 중인 상품. [다른 상품에서 복사] 목록에서 뺀다. 저장 전인 새 상품은 주지 않는다. */
  excludeGoodId?: string | null;
}) {
  const [dialog, setDialog] = useState<'templates' | 'copy' | null>(null);
  const [message, setMessage] = useState('');
  /** 가져오지 못한 이유(고시가 없는 상품·읽기 실패). 선택창이 열려 있으면 그 안에, 아니면 버튼 아래에 보인다. */
  const [problem, setProblem] = useState('');
  const [suggestion, setSuggestion] = useState<{ key: string; type: string; preset: Preset } | null>(null);
  const [dismissed, setDismissed] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  /* 이름별 조회 결과 캐시(null = 템플릿 없음). 같은 이름을 다시 부르지 않는다. */
  const presetByName = useRef(new Map<string, Preset | null>());
  const suggestKey = suggestNames.join('\u0000');
  useEffect(() => {
    if (!suggestKey || readOnly || dismissed === suggestKey) return;
    let alive = true;
    const names = suggestKey.split('\u0000');
    suggestNoticePresetByNames(names, async (name) => {
      const result = await findGoodNoticePresets(name, 1);
      return 'error' in result ? SUGGEST_LOOKUP_FAILED : result.presets[0] ?? null;
    }, presetByName.current, () => !alive).then((found) => {
      if (alive) setSuggestion(found ? { key: suggestKey, type: found.name, preset: found.preset } : null);
    }).catch(() => { if (alive) setSuggestion(null); });
    return () => { alive = false; };
  }, [suggestKey, readOnly, dismissed]);
  function closeDialog() { setDialog(null); setProblem(''); }
  const currentValues = () => noticeFormValues(rootRef.current?.closest('form'));
  /** 가져오기 전 확인. 적어 둔 값이 바뀌거나 지워지는 칸이 없으면 묻지 않는다. 폼을 못 찾으면(`plan` 없음) 무엇이 바뀌는지 몰라 묻는다. */
  async function confirmReplace(source: string, plan: NoticeApplyPlan | null): Promise<boolean> {
    if (plan && !plan.replaced.length && !plan.cleared.length) return true;
    return adminConfirm({ title: '상품정보제공고시를 바꿀까요?', message: plan ? noticeReplaceMessage(source, plan) : `지금 적어 둔 칸이 ‘${source}’ 내용으로 바뀝니다.`, confirmLabel: '바꾸기' });
  }
  /** 템플릿을 적용한다. 확인에서 취소하거나 가져오지 못하면 false라 선택창이 그대로 남는다. */
  async function applyPreset(preset: Preset): Promise<boolean> {
    setProblem('');
    const current = currentValues();
    if (!current && GOODS_NOTICE_FIELDS.some((field) => isBlank(preset.notice[field.key]))) { setProblem(FORM_UNREADABLE_MESSAGE); return false; }
    const plan = current ? planNoticeApply(preset.notice, current, true) : null;
    if (!await confirmReplace(preset.name, plan)) return false;
    onApply(plan ? plan.notice : preset.notice,copyKcTemplate?preset.kcTemplate:undefined);
    setDismissed(suggestion?.key ?? ''); setSuggestion(null);
    /* TKT-006: 등록 화면과 저장된 상품 모두 KC 틀을 같은 화면 KC 정보의 새 미검토 모델로 채운다(공개 판정은 그대로). */
    setMessage(`${noticePresetAppliedMessage(preset.name, plan)}${copyKcTemplate&&preset.kcTemplate?KC_MESSAGE:''}`);
    return true;
  }
  /** 고른 상품의 고시를 읽어 7칸을 그대로 옮긴다. 읽지 못했거나 비어 있으면 선택창 안에 알리고 창을 닫지 않는다. */
  async function copyFromGood(good: AdminGoodsPickerRow): Promise<boolean> {
    setProblem('');
    const result = await loadGoodNoticeOf(good.id);
    if (!result.notice) { setProblem(result.error ?? EMPTY_NOTICE_MESSAGE); return false; }
    /* 목록은 고시를 적어 둔 상품만 보이지만, 목록을 연 뒤 그 상품의 고시가 비워졌을 수 있다. */
    if (noticeIsBlank(result.notice)) { setProblem(EMPTY_NOTICE_MESSAGE); return false; }
    const current = currentValues();
    if (!await confirmReplace(good.name, current ? planNoticeApply(result.notice, current, false) : null)) return false;
    onApply(result.notice);
    setMessage(`‘${good.name}’의 ${FIELD_COUNT}개 칸을 가져왔습니다.`);
    return true;
  }
  const shown = suggestion && suggestion.key === suggestKey && !readOnly ? suggestion : null;
  const problemNote = problem ? <p className="text-sm text-destructive" role="alert">{problem}</p> : null;
  return <div className="flex min-w-0 flex-col gap-3" data-good-notice-picker="" ref={rootRef}>
    {shown ? <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-primary-soft px-3 py-2 text-sm text-primary-soft-foreground" data-good-notice-suggestion="">
      <span className="min-w-0">카테고리 ‘{shown.type}’에 맞는 템플릿이 있습니다.</span>
      <button className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" onClick={() => { void applyPreset(shown.preset); }} type="button">{shown.preset.name} 적용</button>
    </div> : null}
    <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
      <span className="inline-flex items-center gap-1">
        <button aria-haspopup="dialog" className={buttonVariants({ variant: 'outline' })} data-slot="button" disabled={readOnly} onClick={() => setDialog('templates')} type="button"><ListChecks aria-hidden="true" />템플릿에서 가져오기</button>
        <AdminHelpTip help={GOOD_EDITOR_B7_HELP.noticeTemplate} label="템플릿에서 가져오기" />
      </span>
      <span className="inline-flex items-center gap-1">
        <button aria-haspopup="dialog" className={buttonVariants({ variant: 'outline' })} data-slot="button" disabled={readOnly} onClick={() => setDialog('copy')} type="button"><Copy aria-hidden="true" />다른 상품에서 복사</button>
        <AdminHelpTip help={GOOD_EDITOR_HELP.noticeCopy} label="다른 상품에서 복사" />
      </span>
      {/* 템플릿을 만들고 고치는 곳. 작성 중인 상품을 떠나지 않게 새 탭으로 연다(A/S·사이즈·이벤트 템플릿과 같은 자리). */}
      <Link className="text-sm underline underline-offset-4" href={GOODS_NOTICE_PRESETS_PATH} rel="noreferrer" target="_blank">상품정보제공고시 템플릿 관리 ↗</Link>
    </div>
    {message && <p className="text-sm text-foreground" role="status">{message}</p>}
    {dialog ? null : problemNote}
    {dialog === 'templates' ? <AdminPickerDialog<Preset>
      description="고르면 템플릿에 적힌 칸만 그 내용으로 바뀝니다. 템플릿에서 비워 둔 칸은 지금 값 그대로 둡니다."
      emptyText="맞는 템플릿이 없습니다. 템플릿은 ‘상품정보제공고시 템플릿 관리’에서 만듭니다."
      footer={problemNote}
      load={loadNoticePresets}
      onClose={closeDialog}
      onSelect={applyPreset}
      rowKey={(preset) => preset.id}
      rowView={(preset) => noticePresetRowView(preset, copyKcTemplate)}
      searchPlaceholder="템플릿 이름으로 찾기"
      title="상품정보제공고시 템플릿 고르기"
    /> : null}
    {dialog === 'copy' ? <AdminGoodsPicker
      description="고르면 상품정보제공고시 7개 칸이 그 상품의 내용으로 바뀝니다."
      excludedNote={excludeGoodId ? '상품정보제공고시를 적지 않은 상품과 지금 편집 중인 상품은 목록에서 뺐습니다.' : '상품정보제공고시를 적지 않은 상품은 목록에서 뺐습니다.'}
      footer={problemNote}
      load={noticeSourceLoader(excludeGoodId)}
      onClose={closeDialog}
      onSelect={copyFromGood}
      title="상품정보제공고시를 복사할 상품 고르기"
    /> : null}
  </div>;
}
