'use client';

import { useActionState, useId, useState } from 'react';
import { Check } from 'lucide-react';
import {
  saveAdminCampaignPresentationAction,
  type AdminCampaignPresentationActionState,
} from '@/app/admin/campaign-presentation-actions';
import { AdminField, AdminFormGrid, AdminNotice } from '@/components/admin/console/AdminKit';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import type { AdminCampaignRecord } from '@/lib/admin/campaigns';
import {
  CAMPAIGN_CARD_LINK_MAX_LENGTH,
  CAMPAIGN_POPUP_LOCATION_MAX_LENGTH,
  CAMPAIGN_POPUP_MODES,
  CAMPAIGN_POPUP_MODE_LABELS,
} from '@/lib/campaign-presentation';
import { InlineNotice } from './fields';

/*
 * 캠페인 노출 설정 패널(스펙 C §2.8). 캠페인 편집 화면에서 저장된 캠페인에만 그린다.
 *
 * 캠페인 본문 폼과는 독립된 폼이다(회원 등급·카드팩 교환처 패널과 같은 두-폼 관례) — 서로 다른 설정이라 한쪽이
 * 실패해도 다른 쪽은 그대로고, 하나의 폼에 저장 버튼 둘을 두면 엔터가 어느 쪽으로 갈지 마크업 순서에 맡기게 된다.
 *
 * 세 칸은 제어 입력이다. React 의 폼 액션은 끝나면 비제어 칸을 저장된 기본값으로 되돌려, 검증 오류로 돌아온 입력이
 * 오류 문구만 남기고 사라진다. 제어 값이면 고친 내용이 그대로 남는다. 저장이 성공하면 서버가 다시 내려 준 노출 설정이
 * 바뀌어 폼이 새 기본값으로 다시 시작한다(아래 폼 key).
 */

const NO_POPUP_LABEL = '싣지 않음 — EVENT에 보입니다';

function PresentationForm({
  action,
  campaign,
  pending,
  state,
}: {
  action: (formData: FormData) => void;
  campaign: AdminCampaignRecord;
  pending: boolean;
  state: AdminCampaignPresentationActionState;
}) {
  const { presentation } = campaign;
  const unavailable = presentation === null;
  const [popupMode, setPopupMode] = useState<string>(presentation?.popupMode ?? '');
  const [popupLocation, setPopupLocation] = useState(presentation?.popupLocation ?? '');
  const [cardLinkPath, setCardLinkPath] = useState(presentation?.cardLinkPath ?? '');
  /* 저장 뒤 칸을 다시 고치면 '저장했습니다'는 지금 내용이 아니라 이전 저장의 결과다 — 고친 순간 감춘다. */
  const [editedAfter, setEditedAfter] = useState<AdminCampaignPresentationActionState | null>(null);
  const shownState = editedAfter === state && state.message ? { ...state, message: undefined } : state;
  const modeId = useId();
  const locationId = useId();
  const linkId = useId();
  /* POP-UP 에 싣지 않으면 장소는 쓰이지 않는다. 비활성 칸은 제출되지 않아 서버가 비운다 — 칸에도 비어 보이게 해 그 사실을 말한다. */
  const locationEnabled = popupMode !== '';

  return (
    <form
      action={action}
      className="flex min-w-0 flex-col gap-4"
      data-campaign-presentation-form=""
      onChange={() => setEditedAfter(state)}
    >
      <input name="campaignId" type="hidden" value={campaign.id} />
      <fieldset className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0" disabled={unavailable}>
        <legend className="sr-only">노출 설정</legend>
        <AdminFormGrid>
          <AdminField error={state.errors?.popupMode} inputId={modeId} label="POP-UP에 싣기">
            <NativeSelect
              aria-describedby={state.errors?.popupMode ? `${modeId}-error` : undefined}
              aria-invalid={Boolean(state.errors?.popupMode)}
              className="w-full"
              id={modeId}
              name="popupMode"
              onChange={(event) => setPopupMode(event.target.value)}
              value={popupMode}
            >
              <option value="">{NO_POPUP_LABEL}</option>
              {CAMPAIGN_POPUP_MODES.map((mode) => (
                <option key={mode} value={mode}>{CAMPAIGN_POPUP_MODE_LABELS[mode]}</option>
              ))}
            </NativeSelect>
          </AdminField>
          <AdminField
            error={state.errors?.popupLocation}
            hint="고객 화면에 기간 옆에 보입니다. 예: 서울 마포구 월드컵로8길 69 1층"
            inputId={locationId}
            label="장소"
          >
            <Input
              aria-describedby={`${locationId}-hint${state.errors?.popupLocation ? ` ${locationId}-error` : ''}`}
              aria-invalid={Boolean(state.errors?.popupLocation)}
              disabled={!locationEnabled}
              id={locationId}
              maxLength={CAMPAIGN_POPUP_LOCATION_MAX_LENGTH}
              name="popupLocation"
              onChange={(event) => setPopupLocation(event.target.value)}
              type="text"
              value={locationEnabled ? popupLocation : ''}
            />
          </AdminField>
          <AdminField
            error={state.errors?.cardLinkPath}
            hint="비우면 캠페인 페이지로 갑니다. 상품·IP관·카테고리 주소를 넣으면 EVENT 카드와 배너가 그곳으로 바로 갑니다. 예: /ip/hong-sil-quest, /shop/…"
            inputId={linkId}
            label="카드·배너 바로가기"
          >
            <Input
              aria-describedby={`${linkId}-hint${state.errors?.cardLinkPath ? ` ${linkId}-error` : ''}`}
              aria-invalid={Boolean(state.errors?.cardLinkPath)}
              id={linkId}
              maxLength={CAMPAIGN_CARD_LINK_MAX_LENGTH}
              name="cardLinkPath"
              onChange={(event) => setCardLinkPath(event.target.value)}
              placeholder="/ip/hong-sil-quest"
              type="text"
              value={cardLinkPath}
            />
          </AdminField>
        </AdminFormGrid>
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={unavailable || pending} type="submit">
            <Check aria-hidden="true" /> {pending ? '저장 중' : '노출 설정 저장'}
          </Button>
          <InlineNotice state={shownState} />
        </div>
      </fieldset>
    </form>
  );
}

const emptyState: AdminCampaignPresentationActionState = {};

export function CampaignPresentationPanel({ campaign }: { campaign: AdminCampaignRecord }) {
  const [state, action, pending] = useActionState(saveAdminCampaignPresentationAction, emptyState);
  const { presentation } = campaign;
  /* 서버가 저장한 값이 바뀌면 폼을 새 기본값으로 다시 시작한다. 결과 문구(state)는 이 패널에 있어 그대로 남는다. */
  const formKey = `${campaign.id}:${presentation?.popupMode ?? ''}|${presentation?.popupLocation ?? ''}|${presentation?.cardLinkPath ?? ''}:${presentation === null ? 'unavailable' : 'ready'}`;

  return (
    <section
      aria-labelledby={`campaign-presentation-${campaign.id}`}
      className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4 text-sm text-card-foreground sm:p-5"
      data-campaign-presentation=""
    >
      <header className="flex min-w-0 flex-col gap-1">
        <h3 className="text-base leading-snug font-semibold text-foreground" id={`campaign-presentation-${campaign.id}`}>노출 설정</h3>
        <p className="text-sm text-muted-foreground">EVENT와 POP-UP 중 어디에 보일지, 카드를 누르면 어디로 갈지 정합니다.</p>
      </header>
      {presentation === null ? (
        <AdminNotice title="노출 설정을 불러오지 못했습니다" tone="warning">
          새로고침한 뒤에도 같으면 담당 개발자에게 알려주세요. 캠페인 본문은 위 폼에서 그대로 저장할 수 있습니다.
        </AdminNotice>
      ) : null}
      <PresentationForm action={action} campaign={campaign} key={formKey} pending={pending} state={state} />
    </section>
  );
}
