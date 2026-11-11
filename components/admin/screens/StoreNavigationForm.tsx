'use client';
import { useState, useTransition, type FormEvent } from 'react';
import { saveStoreNavigationAction, type StoreNavigationActionState } from '@/app/admin/store-navigation-actions';
import { ArrowDown, ArrowUp, RotateCcw } from 'lucide-react';
import { useCardRewardsEnabled } from '@/components/shell/CardRewardAvailability';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { Label } from '@/components/admin/kit/ui/label';
import { COMMUNITY_ENABLED } from '@/lib/community-visibility';
import { hrefFor, STOREFRONT_MENU_ITEMS } from '@/lib/routes';
import { useAdminLeaveGuard } from '../useAdminLeaveGuard';
import type { StoreSettingsSnapshot } from '@/lib/admin/store-settings';
import { DEFAULT_STORE_NAVIGATION, parseStoreNavigation, resolveStorefrontNavigation, storefrontNavigation, STORE_MENU_LABEL_LIMIT, type StoreNavigation } from '@/lib/store-navigation';

const baseLabels = new Map(STOREFRONT_MENU_ITEMS.map(item => [item.id, item.label]));
const GROUP = 'flex min-w-0 flex-col gap-4 rounded-lg border p-4 sm:p-5';
/* float 하면 legend가 테두리 선 위가 아니라 상자 안 첫 줄(제목)로 선다. */
const LEGEND = 'float-left mb-1 w-full text-sm font-semibold text-foreground';
const SEGMENT = 'h-7 rounded-md px-2.5 text-[0.8rem] text-muted-foreground hover:bg-transparent hover:text-foreground aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm';

export function StoreNavigationForm({ settings, canEdit, operationId }: { settings: StoreSettingsSnapshot; canEdit: boolean; operationId: string }) {
  const [draft, setDraft] = useState<StoreNavigation>(settings.navigation ?? DEFAULT_STORE_NAVIGATION);
  const [editingStamp, setEditingStamp] = useState(settings.updatedAt);
  const [saveOperationId, setSaveOperationId] = useState(operationId);
  const [state, setState] = useState<StoreNavigationActionState>({});
  const [pending, startTransition] = useTransition();
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const cardRewardsEnabled = useCardRewardsEnabled();
  const [savedDraft, setSavedDraft] = useState(draft);
  useAdminLeaveGuard({ dirty: JSON.stringify(draft) !== JSON.stringify(savedDraft) });

  function change(update: (previous: StoreNavigation) => StoreNavigation) {
    setDraft(update);
    setSaveOperationId(crypto.randomUUID());
    setState({});
  }
  function move(index: number, direction: -1 | 1) {
    if (index + direction < 0 || index + direction >= draft.length) return;
    change(previous => {
      const next = [...previous];
      [next[index], next[index + direction]] = [next[index + direction], next[index]];
      return next;
    });
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit || pending) return;
    const payload = draft.map(entry => ({ ...entry, label: entry.label.trim() }));
    startTransition(async () => {
      try {
        const result = await saveStoreNavigationAction(payload, editingStamp, saveOperationId);
        setState(result);
        if (result.updatedAt) {
          setEditingStamp(result.updatedAt);
          const saved = parseStoreNavigation(payload);
          if (saved) setDraft(saved);
          setSavedDraft(saved ?? draft);
        }
      } catch {
        setState({ error: '저장 결과를 확인하지 못했습니다. 입력값을 유지한 채 다시 저장해주세요.' });
      }
    });
  }
  const parsed = parseStoreNavigation(draft.map(entry => ({ ...entry, label: entry.label.trim() })));
  const preview = parsed ? resolveStorefrontNavigation(storefrontNavigation(parsed), cardRewardsEnabled) : null;

  /* 공개 메뉴 편집(템플릿 룩, ADR-0028). 이름·순서·노출과 저장 계약은 그대로다. */
  return <form onSubmit={submit} className="flex min-w-0 flex-col gap-5">
    <p className="text-sm text-muted-foreground">스토어 상단 메뉴와 모바일 전체 메뉴의 이름·순서·노출을 함께 설정합니다. 메뉴는 기존 페이지로 연결됩니다.</p>
    <fieldset disabled={pending || !canEdit} className={GROUP}>
      <legend className={LEGEND}>메뉴 설정</legend>
      <ol className="flex flex-col">
        {draft.map((entry, index) => {
          const baseLabel = baseLabels.get(entry.id)!;
          const unavailable = entry.id === 'community' && !COMMUNITY_ENABLED ? '커뮤니티가 비공개여서 현재 메뉴에 표시되지 않습니다.'
            : entry.id === 'packs' && !cardRewardsEnabled ? '카드 리워드가 중지되어 현재 메뉴에 표시되지 않습니다.' : null;
          return <li className="grid grid-cols-[24px_minmax(0,1fr)] items-start gap-3 border-b py-4 last:border-b-0 lg:grid-cols-[28px_minmax(180px,1fr)_minmax(170px,220px)_auto] lg:items-center lg:gap-4" key={entry.id}>
            <span className="text-sm font-semibold text-muted-foreground tabular-nums" aria-label={`${index + 1}번째 메뉴`}>{index + 1}</span>
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor={`store-menu-${entry.id}`}>{baseLabel} 메뉴명</Label>
              <Input id={`store-menu-${entry.id}`} value={entry.label} required aria-describedby={`store-menu-${entry.id}-hint`}
                onChange={event => change(previous => previous.map(item => item.id === entry.id ? { ...item, label: event.target.value } : item))} />
              <small className="text-xs text-muted-foreground [overflow-wrap:anywhere]" id={`store-menu-${entry.id}-hint`}>{[...entry.label].length} / {STORE_MENU_LABEL_LIMIT}자 · {hrefFor(entry.id)}</small>
              {unavailable ? <small className="text-xs text-warning">{unavailable}</small> : null}
            </div>
            <label className="col-start-2 inline-flex min-h-9 w-fit items-center gap-2 text-sm lg:col-start-auto"><input type="checkbox" checked={entry.visible} disabled={entry.id === 'shop'}
              onChange={event => change(previous => previous.map(item => item.id === entry.id ? { ...item, visible: event.target.checked } : item))} />
              {baseLabel} 노출{entry.id === 'shop' ? ' (필수)' : ''}
            </label>
            <div className="col-start-2 flex gap-1.5 lg:col-start-auto">
              <Button size="sm" type="button" variant="outline" aria-label={`${baseLabel} 위로`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp aria-hidden="true" />위로</Button>
              <Button size="sm" type="button" variant="outline" aria-label={`${baseLabel} 아래로`} disabled={index === draft.length - 1} onClick={() => move(index, 1)}><ArrowDown aria-hidden="true" />아래로</Button>
            </div>
          </li>;
        })}
      </ol>
      <Button className="self-start" size="sm" type="button" variant="outline" onClick={() => change(() => DEFAULT_STORE_NAVIGATION.map(entry => ({ ...entry })))}><RotateCcw aria-hidden="true" />기본 메뉴로 되돌리기</Button>
    </fieldset>
    <section className="flex min-w-0 flex-col gap-4 rounded-lg border p-4 sm:p-5" aria-label="메뉴 미리보기">
      <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-semibold">저장 전 미리보기</h3>
        <div className="inline-flex items-center rounded-lg bg-muted p-0.5"><Button type="button" className={SEGMENT} size="sm" variant="ghost" aria-pressed={device === 'desktop'} onClick={() => setDevice('desktop')}>PC</Button><Button type="button" className={SEGMENT} size="sm" variant="ghost" aria-pressed={device === 'mobile'} onClick={() => setDevice('mobile')}>모바일</Button></div>
      </div>
      {preview ? <div className="group/frame w-full min-w-0 overflow-hidden rounded-lg border bg-background data-[device=mobile]:w-[min(100%,390px)]" data-device={device}>
        <div className="border-b p-5 text-center text-xl font-bold">스토어</div>
        <nav aria-label="노출될 메뉴" className="overflow-x-auto"><ol className="flex w-max min-w-full items-center justify-center gap-6 px-5 py-4 group-data-[device=mobile]/frame:justify-start">{preview.map(item => <li className="flex-none text-sm whitespace-nowrap" key={item.id}>{item.label}</li>)}</ol></nav>
      </div> : <p className="text-sm text-muted-foreground">각 메뉴명을 1~20자로 입력하면 미리보기가 표시됩니다.</p>}
      <p className="text-sm text-muted-foreground">모바일 전체 메뉴의 스토어 항목도 이 순서로 표시됩니다. 카테고리의 하위 메뉴와 계정·주문·법정 안내는 각 페이지에서 관리합니다.</p>
    </section>
    {state.error ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}
    {state.message ? <p role="status" className="text-sm text-success">{state.message}</p> : null}
    {canEdit ? <Button className="self-start" type="submit" disabled={pending}>{pending ? '저장 중…' : '공개 메뉴 저장'}</Button> : <p className="text-sm text-muted-foreground">관리자(admin)만 메뉴 설정을 저장할 수 있습니다.</p>}
  </form>;
}
