'use client';
import { useEffect, useRef, useState } from 'react';
import { saveCollectibleFeaturesAction, type CollectibleFeaturesResult } from '@/app/admin/collectible-features-actions';
import { AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { Button } from '@/components/admin/kit/ui/button';
import { Switch } from '@/components/admin/kit/ui/switch';
import { COLLECTIBLE_FEATURE_SURFACES, type AdminCollectibleFeaturesState } from '@/lib/admin/collectible-features';
import { adminConfirm } from '@/lib/admin/confirm';
import { statusTone } from '@/lib/admin/status-tone';
import { COLLECTIBLE_FEATURE_IDS, COLLECTIBLE_FEATURE_LABELS, type CollectibleFeature, type CollectibleFeatures } from '@/lib/collectible-features';

const UNKNOWN = '저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.';

const pick = (state: CollectibleFeatures): CollectibleFeatures => ({ binder: state.binder, market: state.market, exchange: state.exchange });

/**
 * 카드 바인더·굿즈 마켓·카드 트레이드 공개 스위치. 세 값을 한 번에 저장한다.
 * 켜는 쪽은 고객 화면에 기능이 다시 드러나므로 확인창을 거친다. 끄는 쪽은 바로 저장한다.
 * 결과가 불확실하면 입력과 요청 ID를 고정해 같은 요청으로만 다시 확인한다(자동 발주확인 패널과 같은 규칙).
 */
export function CollectibleFeaturesForm({ initial }: { initial: AdminCollectibleFeaturesState }) {
  const [state, setState] = useState(initial);
  const [draft, setDraft] = useState<CollectibleFeatures>(() => pick(initial));
  const [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false);
  const [message, setMessage] = useState(''), [error, setError] = useState(false);
  const request = useRef<(CollectibleFeatures & { revision: number; id: string }) | null>(null);
  const resultRef = useRef<HTMLParagraphElement>(null), focusResult = useRef(false);
  useEffect(() => {
    if (!focusResult.current) return;
    focusResult.current = false;
    resultRef.current?.focus();
  });
  const changed = COLLECTIBLE_FEATURE_IDS.some((id) => draft[id] !== state[id]);
  const enabling = COLLECTIBLE_FEATURE_IDS.filter((id) => draft[id] && !state[id]);

  async function save() {
    if (pending) return;
    if (!request.current && enabling.length) {
      const names = enabling.map((id) => COLLECTIBLE_FEATURE_LABELS[id]).join('·');
      const ok = await adminConfirm({
        title: `${names} 공개`,
        message: `공개하면 고객 화면에 ${names} 메뉴·링크가 다시 나타나고, 주소로 누구나 열 수 있습니다. 운영하지 않기로 한 기능입니다. 공개할까요?`,
        confirmLabel: '공개',
      });
      if (!ok) return;
    }
    request.current ??= { ...draft, revision: state.revision, id: crypto.randomUUID() };
    setPending(true); setMessage('');
    let result: CollectibleFeaturesResult;
    try {
      const sent = request.current;
      result = await saveCollectibleFeaturesAction(sent.binder, sent.market, sent.exchange, sent.revision, sent.id);
    } catch { result = { error: UNKNOWN, uncertain: true }; }
    setPending(false); focusResult.current = true;
    if ('error' in result) { setMessage(result.error); setError(true); setUncertain(Boolean(result.uncertain)); if (!result.uncertain) request.current = null; return; }
    setState(result.state); setDraft(pick(result.state)); setUncertain(false); setError(false); request.current = null;
    const open = COLLECTIBLE_FEATURE_IDS.filter((id) => result.state[id]).map((id) => COLLECTIBLE_FEATURE_LABELS[id]);
    setMessage(open.length ? `저장했습니다. 공개 중: ${open.join(', ')}.` : '저장했습니다. 세 기능 모두 고객 화면에서 숨기고 막았습니다.');
  }

  const toggle = (id: CollectibleFeature, checked: boolean) => setDraft((current) => ({ ...current, [id]: checked }));

  return <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
    <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0" disabled={pending || uncertain}>
      <legend className="sr-only">기능별 공개 여부</legend>
      <ul className="flex flex-col divide-y rounded-lg border">
        {COLLECTIBLE_FEATURE_IDS.map((id) => {
          const labelId = `collectible-feature-${id}-label`, hintId = `collectible-feature-${id}-hint`;
          return <li className="flex items-start justify-between gap-4 p-3" key={id}>
            <div className="flex min-w-0 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium" id={labelId}>{COLLECTIBLE_FEATURE_LABELS[id]}</span>
                <AdminStatusBadge tone={statusTone('setting', state[id] ? 'active' : 'inactive')}>{state[id] ? '공개 중' : '숨김'}</AdminStatusBadge>
              </span>
              <span className="text-xs text-muted-foreground" id={hintId}>{COLLECTIBLE_FEATURE_SURFACES[id]}</span>
            </div>
            <Switch aria-describedby={hintId} aria-labelledby={labelId} checked={draft[id]} disabled={pending || uncertain}
              onCheckedChange={(checked) => toggle(id, checked)} />
          </li>;
        })}
      </ul>
    </fieldset>
    <div className="flex flex-wrap items-center gap-3">
      <Button type="submit" disabled={pending || (!changed && !uncertain)}>{pending ? '저장 중…' : uncertain ? '같은 요청 결과 확인' : '설정 저장'}</Button>
      {!changed && !uncertain && !pending && !message ? <span className="text-xs text-muted-foreground">공개 여부를 바꾸면 저장할 수 있습니다.</span> : null}
      {message ? <p className={`text-sm outline-none ${error ? 'text-destructive' : 'text-success'}`} ref={resultRef} role={error ? 'alert' : 'status'} tabIndex={-1}>{message}</p> : null}
    </div>
  </form>;
}
