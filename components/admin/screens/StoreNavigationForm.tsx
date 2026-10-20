'use client';
import { useState, useTransition, type FormEvent } from 'react';
import { saveStoreNavigationAction, type StoreNavigationActionState } from '@/app/admin/store-navigation-actions';
import { useCardRewardsEnabled } from '@/components/shell/CardRewardAvailability';
import { COMMUNITY_ENABLED } from '@/lib/community-visibility';
import { hrefFor, STOREFRONT_MENU_ITEMS } from '@/lib/routes';
import type { StoreSettingsSnapshot } from '@/lib/admin/store-settings';
import { DEFAULT_STORE_NAVIGATION, parseStoreNavigation, resolveStorefrontNavigation, storefrontNavigation, STORE_MENU_LABEL_LIMIT, type StoreNavigation } from '@/lib/store-navigation';

const baseLabels = new Map(STOREFRONT_MENU_ITEMS.map(item => [item.id, item.label]));

export function StoreNavigationForm({ settings, canEdit, operationId }: { settings: StoreSettingsSnapshot; canEdit: boolean; operationId: string }) {
  const [draft, setDraft] = useState<StoreNavigation>(settings.navigation ?? DEFAULT_STORE_NAVIGATION);
  const [editingStamp, setEditingStamp] = useState(settings.updatedAt);
  const [saveOperationId, setSaveOperationId] = useState(operationId);
  const [state, setState] = useState<StoreNavigationActionState>({});
  const [pending, startTransition] = useTransition();
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const cardRewardsEnabled = useCardRewardsEnabled();

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
        }
      } catch {
        setState({ error: '저장 결과를 확인하지 못했습니다. 입력값을 유지한 채 다시 저장해주세요.' });
      }
    });
  }
  const parsed = parseStoreNavigation(draft.map(entry => ({ ...entry, label: entry.label.trim() })));
  const preview = parsed ? resolveStorefrontNavigation(storefrontNavigation(parsed), cardRewardsEnabled) : null;

  return <form onSubmit={submit} className="admin-store-navigation">
    <p>스토어 상단 메뉴와 모바일 전체 메뉴의 이름·순서·노출을 함께 설정합니다. 메뉴는 기존 페이지로 연결됩니다.</p>
    <fieldset disabled={pending || !canEdit}>
      <legend>메뉴 설정</legend>
      <ol className="admin-store-navigation__items">
        {draft.map((entry, index) => {
          const baseLabel = baseLabels.get(entry.id)!;
          const unavailable = entry.id === 'community' && !COMMUNITY_ENABLED ? '커뮤니티가 비공개여서 현재 메뉴에 표시되지 않습니다.'
            : entry.id === 'packs' && !cardRewardsEnabled ? '카드 리워드가 중지되어 현재 메뉴에 표시되지 않습니다.' : null;
          return <li key={entry.id}>
            <span className="admin-store-navigation__number" aria-label={`${index + 1}번째 메뉴`}>{index + 1}</span>
            <div className="admin-store-navigation__name">
              <label htmlFor={`store-menu-${entry.id}`}>{baseLabel} 메뉴명</label>
              <input id={`store-menu-${entry.id}`} value={entry.label} required aria-describedby={`store-menu-${entry.id}-hint`}
                onChange={event => change(previous => previous.map(item => item.id === entry.id ? { ...item, label: event.target.value } : item))} />
              <small id={`store-menu-${entry.id}-hint`}>{[...entry.label].length} / {STORE_MENU_LABEL_LIMIT}자 · {hrefFor(entry.id)}</small>
              {unavailable ? <small>{unavailable}</small> : null}
            </div>
            <label className="admin-store-navigation__visibility"><input type="checkbox" checked={entry.visible} disabled={entry.id === 'shop'}
              onChange={event => change(previous => previous.map(item => item.id === entry.id ? { ...item, visible: event.target.checked } : item))} />
              {baseLabel} 노출{entry.id === 'shop' ? ' (필수)' : ''}
            </label>
            <div className="admin-store-navigation__move">
              <button className="btn btn-sm btn-ghost" type="button" aria-label={`${baseLabel} 위로`} disabled={index === 0} onClick={() => move(index, -1)}>위로</button>
              <button className="btn btn-sm btn-ghost" type="button" aria-label={`${baseLabel} 아래로`} disabled={index === draft.length - 1} onClick={() => move(index, 1)}>아래로</button>
            </div>
          </li>;
        })}
      </ol>
      <button className="btn btn-sm btn-ghost" type="button" onClick={() => change(() => DEFAULT_STORE_NAVIGATION.map(entry => ({ ...entry })))}>기본 메뉴로 되돌리기</button>
    </fieldset>
    <section className="admin-store-navigation__preview" aria-label="메뉴 미리보기">
      <div className="admin-store-navigation__preview-heading"><h3>저장 전 미리보기</h3>
        <div className="wc-admin-kit__actions"><button type="button" className="btn btn-sm btn-ghost" aria-pressed={device === 'desktop'} onClick={() => setDevice('desktop')}>PC</button><button type="button" className="btn btn-sm btn-ghost" aria-pressed={device === 'mobile'} onClick={() => setDevice('mobile')}>모바일</button></div>
      </div>
      {preview ? <div className="admin-store-navigation__preview-frame" data-device={device}>
        <div className="admin-store-navigation__preview-brand">스토어</div>
        <nav aria-label="노출될 메뉴"><ol>{preview.map(item => <li key={item.id}>{item.label}</li>)}</ol></nav>
      </div> : <p>각 메뉴명을 1~20자로 입력하면 미리보기가 표시됩니다.</p>}
      <p className="muted">모바일 전체 메뉴의 스토어 항목도 이 순서로 표시됩니다. 카테고리의 하위 메뉴와 계정·주문·법정 안내는 각 페이지에서 관리합니다.</p>
    </section>
    {state.error ? <p role="alert" className="admin-form-error">{state.error}</p> : null}
    {state.message ? <p role="status" className="admin-form-success">{state.message}</p> : null}
    {canEdit ? <button className="btn" type="submit" disabled={pending}>{pending ? '저장 중…' : '공개 메뉴 저장'}</button> : <p>관리자(admin)만 메뉴 설정을 저장할 수 있습니다.</p>}
  </form>;
}
