'use client';
import { useEffect, useRef, useState } from 'react';
import { Copy, ListChecks } from 'lucide-react';
import { findGoodNoticePresets, loadGoodNoticeOf } from '@/app/admin/good-notice-actions';
import { AdminHelpTip } from '@/components/admin/console/AdminHelpTip';
import { AdminPickerDialog, type AdminPickerRowView } from '@/components/admin/console/AdminPickerDialog';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { adminConfirm } from '@/lib/admin/confirm';
import { SUGGEST_LOOKUP_FAILED, suggestNoticePresetByNames } from '@/lib/admin/good-notice-suggestion';
import { GOODS_NOTICE_PRESET_PAGE_SIZE, type GoodsKcPresetTemplate, type GoodsNoticePresetPageData } from '@/lib/admin/goods-notice-presets';
import { GOOD_EDITOR_HELP } from '@/lib/admin/help/good-editor';
import type { AdminPickerLoader } from '@/lib/admin/picker';
import { GOODS_NOTICE_FIELDS, type GoodsNoticeInfo } from '@/lib/goods-notice';
import { AdminGoodsPicker, type AdminGoodsPickerRow } from './AdminGoodsPicker';

type Preset = GoodsNoticePresetPageData['presets'][number];
const NO_NAMES: readonly string[] = [];
const EMPTY_NOTICE_MESSAGE = '이 상품에는 적어 둔 고시정보가 없습니다.';
const KC_MESSAGE = ' KC 정보에도 유형 틀이 들어갑니다. 모델·옵션·번호·사업자는 직접 입력해주세요.';

/** 템플릿 선택창의 조회. 서버가 이미 20개씩 나눠 준다. */
const loadNoticePresets: AdminPickerLoader<Preset> = async (request) => {
  const result = await findGoodNoticePresets(request.query, request.page);
  if ('error' in result) return { error: result.error };
  return { rows: result.presets, total: result.total, page: result.filters.page, pageSize: GOODS_NOTICE_PRESET_PAGE_SIZE };
};

const clip = (text: string) => { const chars = [...text.trim()]; return chars.length > 24 ? `${chars.slice(0, 24).join('')}…` : chars.join(''); };

/** 템플릿 한 줄: 이름 아래에 제조사·소재와 KC 유형 틀이 들어 있는지를 보여 이름만으로 고르지 않게 한다. KC 틀은 가져오는 화면에서만 말한다. */
export function noticePresetRowView(preset: Preset, withKcTemplate: boolean): AdminPickerRowView {
  const { maker, material } = preset.notice;
  const parts = [maker?.trim() ? `제조사 ${clip(maker)}` : '', material?.trim() ? `소재 ${clip(material)}` : '', withKcTemplate && preset.kcTemplate ? 'KC 유형 틀 포함' : ''].filter(Boolean);
  return { title: preset.name, meta: parts.join(' · ') || undefined };
}

/** 7칸이 모두 비었는가(공백만 있어도 빈 것). */
export const noticeIsBlank = (notice: GoodsNoticeInfo) => GOODS_NOTICE_FIELDS.every((field) => !notice[field.key]?.trim());

/** 폼에 지금 적혀 있는 고시정보 칸 수. 칸 이름(formName)으로 읽는다. 폼을 못 찾으면 null. */
export function filledNoticeFields(form: { elements: { namedItem(name: string): unknown } } | null | undefined): number | null {
  if (!form) return null;
  return GOODS_NOTICE_FIELDS.filter((field) => {
    const value = (form.elements.namedItem(field.formName) as { value?: unknown } | null)?.value;
    return typeof value === 'string' && value.trim() !== '';
  }).length;
}

/*
 * 고시정보 7칸을 다른 곳에서 가져오는 두 버튼. 템플릿 목록과 상품 목록은 모두 공용 선택창에서 고른다(화면 규칙 1).
 * 상품 폼 안에 놓이므로 버튼은 모두 type="button"이다. 선택창은 body로 포털돼 폼 밖에서 열린다.
 * 대표 카테고리 이름에 맞는 템플릿은 제안만 한다 — 고시는 법정 표시라 사람이 누를 때만 적용한다.
 * 가져오면 7칸이 모두 바뀌므로, 지금 적어 둔 값이 있을 때만 확인한다(화면 규칙 7). 칸 값은 props에 없어 폼의 칸 이름으로 읽는다.
 */
export function GoodNoticePicker({ onApply, readOnly=false, copyKcTemplate=true, suggestNames=NO_NAMES }: {
  onApply: (notice: GoodsNoticeInfo, kcTemplate?:GoodsKcPresetTemplate|null) => void;readOnly?:boolean;copyKcTemplate?:boolean;
  /** 대표 카테고리 이름(말단 → 위로). 앞에서부터 템플릿이 있는 첫 이름으로 제안한다. 비어 있으면 제안하지 않는다. */
  suggestNames?: readonly string[];
}) {
  const [dialog, setDialog] = useState<'templates' | 'copy' | null>(null);
  const [message, setMessage] = useState('');
  /** 상품 선택창 안에 보이는 안내(고시가 없는 상품·읽기 실패). */
  const [copyNotice, setCopyNotice] = useState('');
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
  function closeDialog() { setDialog(null); setCopyNotice(''); }
  /** 7칸을 바꾸기 전 확인. 적어 둔 값이 하나도 없으면 묻지 않고, 폼을 못 찾으면 있다고 보고 묻는다. */
  async function confirmReplace(source: string): Promise<boolean> {
    if (filledNoticeFields(rootRef.current?.closest('form')) === 0) return true;
    return adminConfirm({ title: '고시정보 바꾸기', message: `지금 적어 둔 고시정보 7개가 모두 ‘${source}’ 내용으로 바뀝니다.`, confirmLabel: '바꾸기' });
  }
  /** 템플릿을 적용한다. 확인에서 취소하면 false라 선택창이 그대로 남는다. */
  async function applyPreset(preset: Preset): Promise<boolean> {
    if (!await confirmReplace(preset.name)) return false;
    onApply(preset.notice,copyKcTemplate?preset.kcTemplate:undefined);
    setDismissed(suggestion?.key ?? ''); setSuggestion(null);
    /* TKT-006: 등록 화면과 저장된 상품 모두 KC 틀을 같은 화면 KC 정보의 새 미검토 모델로 채운다(공개 판정은 그대로). */
    setMessage(`‘${preset.name}’ 템플릿의 7개 칸을 가져왔습니다.${copyKcTemplate&&preset.kcTemplate?KC_MESSAGE:''}`);
    return true;
  }
  /** 고른 상품의 고시를 읽어 적용한다. 읽지 못했거나 비어 있으면 선택창 안에 알리고 창을 닫지 않는다. */
  async function copyFromGood(good: AdminGoodsPickerRow): Promise<boolean> {
    setCopyNotice('');
    const result = await loadGoodNoticeOf(good.id);
    if (!result.notice) { setCopyNotice(result.error ?? EMPTY_NOTICE_MESSAGE); return false; }
    if (noticeIsBlank(result.notice)) { setCopyNotice(EMPTY_NOTICE_MESSAGE); return false; }
    if (!await confirmReplace(good.name)) return false;
    onApply(result.notice);
    setMessage(`‘${good.name}’의 고시정보 7개 칸을 가져왔습니다.`);
    return true;
  }
  const shown = suggestion && suggestion.key === suggestKey && !readOnly ? suggestion : null;
  return <div className="flex min-w-0 flex-col gap-3" data-good-notice-picker="" ref={rootRef}>
    {shown ? <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-primary-soft px-3 py-2 text-sm text-primary-soft-foreground" data-good-notice-suggestion="">
      <span className="min-w-0">카테고리 ‘{shown.type}’에 맞는 템플릿이 있습니다.</span>
      <button className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" onClick={() => { void applyPreset(shown.preset); }} type="button">{shown.preset.name} 적용</button>
    </div> : null}
    <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
      <span className="inline-flex items-center gap-1">
        <button aria-haspopup="dialog" className={buttonVariants({ variant: 'outline' })} data-slot="button" disabled={readOnly} onClick={() => setDialog('templates')} type="button"><ListChecks aria-hidden="true" />템플릿에서 가져오기</button>
        <AdminHelpTip help={GOOD_EDITOR_HELP.noticeTemplate} label="템플릿에서 가져오기" />
      </span>
      <span className="inline-flex items-center gap-1">
        <button aria-haspopup="dialog" className={buttonVariants({ variant: 'outline' })} data-slot="button" disabled={readOnly} onClick={() => setDialog('copy')} type="button"><Copy aria-hidden="true" />다른 상품에서 복사</button>
        <AdminHelpTip help={GOOD_EDITOR_HELP.noticeCopy} label="다른 상품에서 복사" />
      </span>
    </div>
    {message && <p className="text-sm text-foreground" role="status">{message}</p>}
    {dialog === 'templates' ? <AdminPickerDialog<Preset>
      description="고르면 고시정보 7개 칸이 템플릿 내용으로 바뀝니다."
      emptyText="일치하는 템플릿이 없습니다."
      load={loadNoticePresets}
      onClose={closeDialog}
      onSelect={applyPreset}
      rowKey={(preset) => preset.id}
      rowView={(preset) => noticePresetRowView(preset, copyKcTemplate)}
      searchPlaceholder="템플릿 이름으로 찾기"
      selectLabel="적용"
      title="고시정보 템플릿 선택"
    /> : null}
    {dialog === 'copy' ? <AdminGoodsPicker
      description="고른 상품의 고시정보 7개 칸을 가져옵니다."
      footer={copyNotice ? <p className="text-sm text-destructive" role="alert">{copyNotice}</p> : null}
      onClose={closeDialog}
      onSelect={copyFromGood}
      title="고시정보를 가져올 상품 선택"
    /> : null}
  </div>;
}
