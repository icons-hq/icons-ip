'use client';

import { ADMIN_DIALOG_CLOSE_DIRTY_CONFIRM } from '@/lib/admin/dialog-close';
import { focusFirstInvalid } from '@/lib/admin/focus-invalid';
import { createContext, useContext, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import {
  applyShippingNoticeTemplateToGoodsAction,
  readShippingNoticeTemplateAction,
  saveShippingNoticeTemplateAction,
  type ShippingNoticeTemplateActionState,
  type ShippingNoticeTemplateApplyActionResult,
} from '@/app/admin/shipping-notice-template-actions';
import { AdminGoodsPicker, type AdminGoodsPickerRow } from '@/components/admin/AdminGoodsPicker';
import { AdminField, AdminFormGrid, AdminNotice } from '@/components/admin/console/AdminKit';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { Textarea } from '@/components/admin/kit/ui/textarea';
import { adminConfirm } from '@/lib/admin/confirm';
import {
  CHANGED_BY_OTHER, SAVE_CHECK_LABEL, SAVE_FAILED_MESSAGE, SAVE_UNKNOWN_MESSAGE, TEMPLATE_DISCARD_INPUT_CONFIRM,
  TEMPLATE_DISCARD_INPUT_LABEL, TEMPLATE_LATEST_UNREAD_MESSAGE, TEMPLATE_SAVE_OVER_LATEST_LABEL, TEMPLATE_SAVE_OVER_LATEST_NOTE,
  reopenClosedDialog, templateCloseUnknownConfirm,
} from '@/lib/admin/goods-template-save';
import {
  SHIPPING_NOTICE_TEMPLATE_APPLY_LABEL,
  SHIPPING_NOTICE_TEMPLATE_APPLY_MAX,
  SHIPPING_NOTICE_TEMPLATE_CREATE_LABEL,
  SHIPPING_NOTICE_TEMPLATE_CS_EMAIL_MAX,
  SHIPPING_NOTICE_TEMPLATE_CS_NAME_MAX,
  SHIPPING_NOTICE_TEMPLATE_CS_PHONE_MAX,
  SHIPPING_NOTICE_TEMPLATE_LABEL,
  SHIPPING_NOTICE_TEMPLATE_NAME_MAX,
  SHIPPING_NOTICE_TEMPLATE_NOTICE_MAX,
  SHIPPING_NOTICE_TEMPLATE_VALUE_KEYS,
  parseShippingNoticeTemplateInput,
  sameShippingNoticeTemplateValues,
  shippingNoticeTemplateAppliedNotice,
  shippingNoticeTemplateSaveConfirm,
  shippingNoticeTemplateSavedNotice,
  shippingNoticeTemplateValues,
  type ShippingNoticeTemplate,
  type ShippingNoticeTemplateValues,
} from '@/lib/admin/shipping-notice-templates';
import { CustomerServiceDialog } from './CustomerServiceDialog';

/*
 * 배송 안내 템플릿 관리의 움직이는 부분: 목록 위 결과 한 줄, [등록]·[수정] 창, [상품에 적용] 창.
 * 사이즈·A/S·이벤트 템플릿 관리와 같은 모양·같은 말이다(목록 + [수정] 창 + 결과 한 줄 + 다른 사람이 먼저 바꿨을 때의 두 길).
 * 목록 자체는 서버가 그린다(ShippingNoticeTemplatesScreen). 저장하면 서버가 목록을 다시 그린다.
 */

export type ShippingNoticeTemplateFlash = { tone: 'success' | 'warning'; text: string };
type Flash = ShippingNoticeTemplateFlash;
interface Workspace {
  flash: Flash | null;
  openEditor: (template: ShippingNoticeTemplate | null) => void;
  openApply: (template: ShippingNoticeTemplate) => void;
}
const WorkspaceContext = createContext<Workspace | null>(null);

const USAGE_UNREAD_MESSAGE = '이 템플릿을 쓰는 상품 수를 읽지 못해 저장하지 않았습니다. 잠시 뒤 다시 저장해 주세요.';
const GONE_MESSAGE = '템플릿을 찾을 수 없습니다. 창을 닫고 목록을 새로고침해 주세요.';
const NOTHING_CHANGED_MESSAGE = '고친 내용이 없습니다.';
const APPLY_UNKNOWN_MESSAGE = '적용됐는지 확인하지 못했습니다. 다시 눌러도 같은 상품에 두 번 적용되지 않습니다.';
const EXCERPT_CLASS = 'block max-h-24 overflow-auto whitespace-pre-wrap wrap-anywhere';

/** 화면 전체를 감싼다. 결과 한 줄과 열려 있는 창을 들고 있다 — 저장한 줄이 목록에서 다시 그려져도 결과가 남는다. */
export function ShippingNoticeTemplateWorkspace({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [flash, setFlash] = useState<Flash | null>(null);
  const [editor, setEditor] = useState<{ template: ShippingNoticeTemplate | null } | null>(null);
  const [applying, setApplying] = useState<ShippingNoticeTemplate | null>(null);
  const value: Workspace = {
    flash,
    openEditor: (template) => { setFlash(null); setEditor({ template }); },
    openApply: (template) => { setFlash(null); setApplying(template); },
  };
  return <WorkspaceContext.Provider value={value}>
    {children}
    {editor ? <ShippingNoticeTemplateEditor key={editor.template?.id ?? 'new'} template={editor.template}
      onClose={() => setEditor(null)}
      onDone={(notice) => {
        setEditor(null);
        setFlash(notice ? { tone: 'success', text: notice } : null);
        /* 저장한 경우는 서버가 목록을 다시 그린다. 저장하지 않고 닫았는데 목록이 달라졌을 수 있을 때만 다시 읽는다. */
        if (!notice) router.refresh();
      }} /> : null}
    {applying ? <ShippingNoticeTemplateApplyDialog key={applying.id} template={applying}
      onClose={() => setApplying(null)}
      onDone={(next) => { setApplying(null); setFlash(next); }} /> : null}
  </WorkspaceContext.Provider>;
}

/** 목록 위 결과 한 줄(등록·저장·상품 적용). 자리는 늘 있어 결과가 생기면 화면 읽기 도구가 읽는다. */
export function ShippingNoticeTemplateResultLine() {
  const flash = useContext(WorkspaceContext)?.flash;
  return <div aria-live="polite" className="contents" data-shipping-notice-result="">
    {flash ? <AdminNotice tone={flash.tone}>{flash.text}</AdminNotice> : null}
  </div>;
}

/** 화면 머리 오른쪽의 등록 버튼. */
export function ShippingNoticeTemplateCreateButton() {
  const workspace = useContext(WorkspaceContext);
  return <Button disabled={!workspace} onClick={() => workspace?.openEditor(null)} type="button"><Plus aria-hidden="true" />{SHIPPING_NOTICE_TEMPLATE_CREATE_LABEL}</Button>;
}

/** 목록 한 줄의 동작. 준비 중인 템플릿은 [수정]에서 저장해야 상품에 적용할 수 있어 [상품에 적용]을 두지 않는다. */
export function ShippingNoticeTemplateRowActions({ template }: { template: ShippingNoticeTemplate }) {
  const workspace = useContext(WorkspaceContext);
  return <span className="flex flex-wrap items-center gap-1.5">
    <Button disabled={!workspace} onClick={() => workspace?.openEditor(template)} size="xs" type="button" variant="outline">수정</Button>
    {template.status === 'active' ? <Button disabled={!workspace} onClick={() => workspace?.openApply(template)} size="xs" type="button" variant="outline">{SHIPPING_NOTICE_TEMPLATE_APPLY_LABEL}</Button> : null}
  </span>;
}

type SaveRequest = { id: string; updatedAt: string; operationId: string; values: ShippingNoticeTemplateValues };

/** 이 템플릿의 지금 저장된 내용과 쓰는 상품 수. 읽지 못하면 'failed', 없으면 null. */
async function readCurrent(code: string): Promise<ShippingNoticeTemplate | null | 'failed'> {
  try {
    const result = await readShippingNoticeTemplateAction(code);
    return result?.ok ? result.template : 'failed';
  } catch { return 'failed'; }
}

/*
 * 등록·수정 창. 운영자는 이름과 본문만 다룬다 — 코드와 버전은 저장할 때 자동으로 정해진다.
 * [저장]하면 바로 상품에서 고를 수 있고, 이 템플릿을 쓰는 상품의 안내도 함께 바뀐다. 그런 상품이 있으면 저장 전에 몇 개인지 보이고 확인받는다.
 * 다른 사람이 먼저 바꿨으면 입력을 그대로 둔 채 두 길을 고른다: 내 입력으로 덮어쓰기 / 내 입력 버리기.
 * 저장됐는지 모를 때는 같은 내용을 다시 보내 확인한다(두 번 저장되지 않는다).
 * `onDone(결과 문장)`: 저장했으면 목록 위에 보일 문장, 저장하지 않았지만 목록을 다시 읽어야 하면 null. `onClose`: 그냥 닫음.
 */
export function ShippingNoticeTemplateEditor({ template, onClose, onDone }: {
  template: ShippingNoticeTemplate | null; onClose: () => void; onDone: (notice: string | null) => void;
}) {
  const [values, setValues] = useState<ShippingNoticeTemplateValues>(() => shippingNoticeTemplateValues(template));
  /* base: 지금 입력이 딛고 선 저장 내용. latest: 다른 사람이 먼저 바꿨을 때 읽어 둔 지금 저장 내용. */
  const [base, setBase] = useState(template), [latest, setLatest] = useState<ShippingNoticeTemplate | null>(null);
  const [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false), [conflict, setConflict] = useState(false);
  const [message, setMessage] = useState(''), [errors, setErrors] = useState<Record<string, string>>({});
  const busy = useRef(false), request = useRef<SaveRequest | null>(null), form = useRef<HTMLFormElement>(null);
  const prefix = useId();
  const dirty = !sameShippingNoticeTemplateValues(values, shippingNoticeTemplateValues(base));
  const change = (key: keyof ShippingNoticeTemplateValues, next: string) => setValues((current) => ({ ...current, [key]: next }));

  /** 적은 내용에 빠진 것이 있으면 그 칸에서 말하고 false. */
  function checkInput(): boolean {
    const parsed = parseShippingNoticeTemplateInput({ ...values });
    setErrors(parsed.ok ? {} : parsed.errors); setMessage('');
    return parsed.ok;
  }
  async function send(fixed: SaveRequest) {
    if (busy.current) return;
    busy.current = true; setPending(true); setMessage(''); setErrors({}); request.current = fixed;
    const data = new FormData();
    data.set('id', fixed.id); data.set('updatedAt', fixed.updatedAt); data.set('operationId', fixed.operationId);
    for (const key of SHIPPING_NOTICE_TEMPLATE_VALUE_KEYS) data.set(key, fixed.values[key]);
    let result: ShippingNoticeTemplateActionState;
    try { result = await saveShippingNoticeTemplateAction({}, data); }
    catch { result = { uncertain: true, errors: { form: SAVE_UNKNOWN_MESSAGE } }; }
    if (result.saved) { busy.current = false; request.current = null; setPending(false); onDone(shippingNoticeTemplateSavedNotice(result.saved)); return; }
    /* 다른 사람이 먼저 바꿨으면 지금 저장된 내용을 읽어 함께 보인다. 못 읽어도 입력은 그대로 둔다. */
    const found = result.conflict && base ? await readCurrent(base.code) : null;
    busy.current = false; setPending(false);
    if (result.uncertain) { setUncertain(true); setMessage(SAVE_UNKNOWN_MESSAGE); return; }
    request.current = null; setUncertain(false);
    const { form: formError, ...fieldErrors } = result.errors ?? {};
    setErrors(fieldErrors);
    setMessage(formError ?? (Object.keys(fieldErrors).length ? '' : SAVE_FAILED_MESSAGE));
    if (result.conflict) { setConflict(true); setLatest(found && found !== 'failed' ? found : null); }
  }
  async function saveInput() {
    if (busy.current || uncertain || conflict) return;
    if (!checkInput()) { focusFirstInvalid(form.current); return; }
    /* 사용 중인 템플릿을 고친 것 없이 저장하면 바뀌는 것이 없다. 묻지도 보내지도 않는다(준비 중인 템플릿은 저장해야 고를 수 있어 그대로 보낸다). */
    if (base?.status === 'active' && !dirty) { setMessage(NOTHING_CHANGED_MESSAGE); return; }
    if (base) {
      /* 저장하면 안내가 바뀌는 상품 수를 지금 다시 읽는다. 확인창의 수는 저장이 바꿀 범위와 같은 조회에서 온다. */
      busy.current = true; setPending(true);
      const current = await readCurrent(base.code);
      busy.current = false; setPending(false);
      if (current === 'failed') { setMessage(USAGE_UNREAD_MESSAGE); return; }
      if (!current) { setMessage(GONE_MESSAGE); return; }
      if (current.id !== base.id || current.updatedAt !== base.updatedAt) { setConflict(true); setLatest(current); setMessage(CHANGED_BY_OTHER); return; }
      if (current.goodsCount > 0 && !await adminConfirm(shippingNoticeTemplateSaveConfirm(values.name.trim(), current.goodsCount))) return;
    }
    void send({ id: base?.id ?? '', updatedAt: base?.updatedAt ?? '', operationId: crypto.randomUUID(), values });
  }
  async function saveOverLatest() {
    if (busy.current || !base) return;
    /* 두 길을 고르는 동안에는 '다른 사람이 먼저 바꿨습니다'가 계속 보여야 한다. 빠진 칸은 그 칸에서 따로 말한다. */
    const ready = checkInput(); setMessage(CHANGED_BY_OTHER);
    if (!ready) { focusFirstInvalid(form.current); return; }
    let target = latest;
    if (!target) {
      busy.current = true; setPending(true);
      const found = await readCurrent(base.code);
      busy.current = false; setPending(false);
      if (!found || found === 'failed') { setMessage(TEMPLATE_LATEST_UNREAD_MESSAGE); return; }
      target = found; setLatest(found);
    }
    /* 다른 사람이 저장한 내용이 내 입력과 같으면 덮어쓸 것이 없다. 목록만 다시 읽는다. */
    if (target.status === 'active' && sameShippingNoticeTemplateValues(values, shippingNoticeTemplateValues(target))) { onDone(null); return; }
    if (target.goodsCount > 0 && !await adminConfirm(shippingNoticeTemplateSaveConfirm(values.name.trim(), target.goodsCount))) return;
    setBase(target); setLatest(null); setConflict(false);
    void send({ id: target.id, updatedAt: target.updatedAt, operationId: crypto.randomUUID(), values });
  }
  async function discardInput() {
    if (busy.current) return;
    if (await adminConfirm(TEMPLATE_DISCARD_INPUT_CONFIRM)) onDone(null);
  }
  async function close() {
    if (busy.current) return;
    if (uncertain) { if (await adminConfirm(templateCloseUnknownConfirm(false))) onDone(null); else reopenClosedDialog(form.current); return; }
    if (dirty && !await adminConfirm(ADMIN_DIALOG_CLOSE_DIRTY_CONFIRM)) { reopenClosedDialog(form.current); return; }
    if (conflict) onDone(null); else onClose();
  }
  const field = (key: keyof ShippingNoticeTemplateValues) => ({
    id: `${prefix}-${key}`, name: key, value: values[key],
    'aria-invalid': errors[key] ? true : undefined,
    'aria-describedby': errors[key] ? `${prefix}-${key}-error` : undefined,
  });
  return <CustomerServiceDialog title={template ? `${SHIPPING_NOTICE_TEMPLATE_LABEL} 수정` : SHIPPING_NOTICE_TEMPLATE_CREATE_LABEL} busy={pending} onClose={() => { void close(); }} wide>
    <form ref={form} noValidate onSubmit={(event: FormEvent) => { event.preventDefault(); void saveInput(); }} className="flex min-w-0 flex-col gap-4 text-sm" data-shipping-notice-template-form="">
      {base?.status === 'draft' ? <p className="text-muted-foreground" data-shipping-notice-template-pending="">아직 상품에서 고를 수 없는 템플릿입니다. [저장]하면 바로 고를 수 있습니다.</p> : null}
      <fieldset className="m-0 flex min-w-0 flex-col gap-5 border-0 p-0" disabled={pending || uncertain}>
        <legend className="sr-only">템플릿 이름과 안내 글</legend>
        <AdminField label="템플릿 이름" inputId={`${prefix}-name`} error={errors.name} hint="고객에게는 보이지 않는 이름입니다.">
          <Input {...field('name')} className="sm:max-w-md" data-dialog-autofocus="" maxLength={SHIPPING_NOTICE_TEMPLATE_NAME_MAX} onChange={(event) => change('name', event.target.value)} placeholder="예: 기본 배송 안내" />
        </AdminField>
        <AdminField label="배송 안내" inputId={`${prefix}-shippingNotice`} error={errors.shippingNotice} hint="배송비는 여기 적지 않아도 상품 상세에 따로 나옵니다.">
          <Textarea {...field('shippingNotice')} maxLength={SHIPPING_NOTICE_TEMPLATE_NOTICE_MAX} onChange={(event) => change('shippingNotice', event.target.value)} placeholder="예: 결제한 날부터 2~3일 안에 보냅니다." rows={5} />
        </AdminField>
        <AdminField label="도서산간 안내 (선택)" inputId={`${prefix}-remoteAreaNotice`} error={errors.remoteAreaNotice} hint="추가배송비 금액은 적지 않습니다. 금액은 ‘지역별 추가배송비 관리’에 넣은 대로 주문서에서 주소를 넣으면 나옵니다.">
          <Textarea {...field('remoteAreaNotice')} maxLength={SHIPPING_NOTICE_TEMPLATE_NOTICE_MAX} onChange={(event) => change('remoteAreaNotice', event.target.value)} placeholder="예: 제주·도서산간은 하루 이틀 더 걸립니다." rows={3} />
        </AdminField>
        <AdminField label="교환·반품 안내" inputId={`${prefix}-returnExchangeNotice`} error={errors.returnExchangeNotice} hint="반품 주소와 반품비는 여기 적지 않아도 상품 상세에 따로 나옵니다.">
          <Textarea {...field('returnExchangeNotice')} maxLength={SHIPPING_NOTICE_TEMPLATE_NOTICE_MAX} onChange={(event) => change('returnExchangeNotice', event.target.value)} placeholder="예: 주문 상세에서 교환·반품을 신청해 주세요." rows={5} />
        </AdminField>
        <div className="flex min-w-0 flex-col gap-2">
          <AdminFormGrid>
            <AdminField label="고객센터 이름" inputId={`${prefix}-csName`} error={errors.csName}>
              <Input {...field('csName')} maxLength={SHIPPING_NOTICE_TEMPLATE_CS_NAME_MAX} onChange={(event) => change('csName', event.target.value)} />
            </AdminField>
            <AdminField label="고객센터 전화" inputId={`${prefix}-csPhone`} error={errors.csPhone}>
              <Input {...field('csPhone')} inputMode="tel" maxLength={SHIPPING_NOTICE_TEMPLATE_CS_PHONE_MAX} onChange={(event) => change('csPhone', event.target.value)} />
            </AdminField>
            <AdminField label="고객센터 이메일" inputId={`${prefix}-csEmail`} error={errors.csEmail}>
              <Input {...field('csEmail')} maxLength={SHIPPING_NOTICE_TEMPLATE_CS_EMAIL_MAX} onChange={(event) => change('csEmail', event.target.value)} type="email" />
            </AdminField>
          </AdminFormGrid>
          <p className="text-sm text-muted-foreground">전화와 이메일은 하나만 적어도 됩니다.</p>
        </div>
      </fieldset>
      {conflict ? <AdminNotice tone="warning" role="alert">
        <p>{message}</p>
        {latest ? <div className="mt-2 flex min-w-0 flex-col gap-1" data-goods-template-latest="">
          <strong className="font-medium">지금 저장된 내용 · {latest.name}</strong>
          <span className={EXCERPT_CLASS}>{latest.shippingNotice}</span>
          {latest.remoteAreaNotice ? <span className={EXCERPT_CLASS}>{latest.remoteAreaNotice}</span> : null}
          <span className={EXCERPT_CLASS}>{latest.returnExchangeNotice}</span>
          <span className="wrap-anywhere">{[latest.csName, latest.csPhone, latest.csEmail].filter(Boolean).join(' · ')}</span>
        </div> : null}
        <p className="mt-2 text-xs" data-goods-template-overwrite-note="">{TEMPLATE_SAVE_OVER_LATEST_NOTE}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button disabled={pending} onClick={() => { void saveOverLatest(); }} size="sm" type="button">{TEMPLATE_SAVE_OVER_LATEST_LABEL}</Button>
          <Button disabled={pending} onClick={() => { void discardInput(); }} size="sm" type="button" variant="outline">{TEMPLATE_DISCARD_INPUT_LABEL}</Button>
        </div>
      </AdminNotice> : message ? <p className="text-destructive" role="alert">{message}</p> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button disabled={pending} onClick={() => { void close(); }} type="button" variant="ghost">닫기</Button>
        {uncertain ? <Button disabled={pending} onClick={() => { if (request.current) void send(request.current); }} type="button">{SAVE_CHECK_LABEL}</Button>
          : conflict ? null : <Button disabled={pending} type="submit">{pending ? '저장 중…' : '저장'}</Button>}
      </div>
    </form>
  </CustomerServiceDialog>;
}

const APPLY_CLOSE_CONFIRM = (count: number) => ({
  title: '고른 상품에 적용하지 않고 닫을까요?',
  message: `고른 상품 ${count.toLocaleString('ko-KR')}개는 적용되지 않습니다.`,
  confirmLabel: '적용하지 않고 닫기', cancelLabel: '돌아가기',
});

/*
 * [상품에 적용] 창. 공용 상품 선택창에서 여러 개를 고른 뒤 한 번에 적용한다(화면 규칙 1·6).
 * 적용하면 고른 상품의 배송·교환·반품 안내가 이 템플릿 내용으로 바뀐다. 결과는 된 것·이미 쓰던 것·안 된 것으로 나눠 목록 위에 보인다.
 */
export function ShippingNoticeTemplateApplyDialog({ template, onClose, onDone }: {
  template: ShippingNoticeTemplate; onClose: () => void; onDone: (flash: Flash) => void;
}) {
  const [picked, setPicked] = useState<AdminGoodsPickerRow[]>([]);
  const [pending, setPending] = useState(false), [message, setMessage] = useState('');
  const busy = useRef(false), footer = useRef<HTMLDivElement>(null);
  const full = picked.length >= SHIPPING_NOTICE_TEMPLATE_APPLY_MAX;
  const pickedIds = picked.map((good) => good.id);
  async function apply() {
    if (busy.current || !picked.length) return;
    busy.current = true; setPending(true); setMessage('');
    let result: ShippingNoticeTemplateApplyActionResult;
    try { result = await applyShippingNoticeTemplateToGoodsAction({ id: template.id, code: template.code }, picked.map(({ id, name }) => ({ id, name }))); }
    catch { result = { ok: false, error: APPLY_UNKNOWN_MESSAGE }; }
    busy.current = false; setPending(false);
    if (!result.ok) { setMessage(result.error); return; }
    onDone({ tone: result.result.failed.length || result.result.stopped ? 'warning' : 'success', text: shippingNoticeTemplateAppliedNotice(template.name, result.result) });
  }
  async function close() {
    if (busy.current) return;
    if (picked.length && !await adminConfirm(APPLY_CLOSE_CONFIRM(picked.length))) { reopenClosedDialog(footer.current); return; }
    onClose();
  }
  return <AdminGoodsPicker
    closeLabel="닫기"
    description={`고른 상품의 배송·교환·반품 안내가 ‘${template.name}’ 템플릿 내용으로 바뀝니다. 다른 템플릿을 쓰던 상품도 이 템플릿으로 바뀝니다.`}
    footer={<div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-t pt-4" data-shipping-notice-apply="" ref={footer}>
      <div className="flex min-w-0 flex-col gap-1">
        <p role="status">{picked.length ? `고른 상품 ${picked.length.toLocaleString('ko-KR')}개` : '적용할 상품을 골라 주세요.'}</p>
        {message ? <p className="text-destructive" role="alert">{message}</p> : null}
      </div>
      <Button disabled={pending || !picked.length} onClick={() => { void apply(); }} type="button">{pending ? '적용 중…' : `${picked.length.toLocaleString('ko-KR')}개에 적용`}</Button>
    </div>}
    multiple
    onClose={() => { void close(); }}
    onDeselect={(good) => setPicked((current) => current.filter((item) => item.id !== good.id))}
    onSelect={(good) => { setPicked((current) => current.some((item) => item.id === good.id) || current.length >= SHIPPING_NOTICE_TEMPLATE_APPLY_MAX ? current : [...current, good]); }}
    rowBlocked={(good) => full && !pickedIds.includes(good.id) ? `한 번에 ${SHIPPING_NOTICE_TEMPLATE_APPLY_MAX}개까지` : null}
    selectedKeys={pickedIds}
    title="상품 고르기"
  />;
}
