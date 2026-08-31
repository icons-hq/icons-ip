'use client';

import { useState } from 'react';
import type { AdminCampaignActionState } from '@/app/admin/campaign-actions';
import {
  ADMIN_CAMPAIGN_KIND_LABELS,
  ADMIN_CAMPAIGN_SECTION_SPECS,
  ADMIN_CAMPAIGN_STATUS_LABELS,
  ADMIN_CAMPAIGN_STATUSES,
  ADMIN_CAMPAIGN_KINDS,
  ADMIN_CAMPAIGN_MAX_SECTIONS,
  adminCampaignDateTimeInput,
  adminCampaignSectionsInput,
  parseAdminCampaignSections,
  type AdminCampaignRecord,
} from '@/lib/admin/campaigns';
import { ErrorText, Field, FormShell, RecordList, SelectField, TextArea } from '../fields';

/*
 * 캠페인 콘솔 (S8 #330).
 *
 * 슬러그가 곧 URL이자 운영 식별자다 — 수정 모드에서는 읽기 전용으로 잠그고
 * previousId 로 카탈로그 계약(catalog_id_immutable)을 지킨다. 신규 등록에서
 * 오프라인 팝업(events)과 슬러그가 겹치면 DB가 catalog_id_taken 으로 막는다:
 * 레거시 /events/[id] 리다이렉트가 살아 있는 동안 같은 id 의 캠페인이 생기면
 * 그 리다이렉트가 무엇을 가리키는지 알 수 없다.
 *
 * 상세 본문은 sections JSON 직접 편집이 v1 계약이다(티켓 Out of Scope — 랜딩
 * 빌더는 범위 밖). 그래서 블록 스키마를 화면 안에 접어 두고, 저장 왕복 전에
 * 같은 규칙으로 한 번 검사한다. 판정의 진실원은 DB(validate_campaign_sections)다.
 */

function campaignPeriodLabel(campaign: AdminCampaignRecord) {
  const starts = adminCampaignDateTimeInput(campaign.startsAt).replace('T', ' ');
  const ends = adminCampaignDateTimeInput(campaign.endsAt).replace('T', ' ');
  return `${starts} ~ ${ends}`;
}

function campaignListLabel(campaign: AdminCampaignRecord) {
  return (
    <span className="col" style={{ gap: 3, minWidth: 0, textAlign: 'left' }}>
      <strong style={{ fontSize: 13 }}>{campaign.title}</strong>
      <span className="faint mono" style={{ fontSize: 11 }}>
        {ADMIN_CAMPAIGN_KIND_LABELS[campaign.kind]}
        {' · '}
        {ADMIN_CAMPAIGN_STATUS_LABELS[campaign.status]}
        {campaign.featuredOrder ? ` · 배너 ${campaign.featuredOrder}` : ''}
      </span>
      <span className="faint mono" style={{ fontSize: 10.5 }}>{campaignPeriodLabel(campaign)}</span>
    </span>
  );
}

/** 블록 스키마 안내. 직접 편집이 계약이면 계약서가 화면에 있어야 한다. */
function SectionSchemaHelp() {
  return (
    <details className="admin-campaign-help">
      <summary>랜딩 구성 JSON 스키마 (블록 {ADMIN_CAMPAIGN_SECTION_SPECS.length}종)</summary>
      <div className="col" style={{ gap: 8, marginTop: 8 }}>
        <p className="muted" style={{ fontSize: 12, lineHeight: 1.7, margin: 0 }}>
          최상위는 블록 배열이고 최대 {ADMIN_CAMPAIGN_MAX_SECTIONS}개까지입니다. 모든 블록은
          {' '}<code>type</code>이 필수이고 <code>anchor</code>(1~20자, 상세 목차 링크)를 선택으로
          받습니다. 목록에 없는 키는 저장되지 않습니다 — 오타는 조용히 통과하는 대신 거절됩니다.
          이 화면은 블록 편집기가 아니라 JSON 직접 편집이 v1 계약입니다.
        </p>
        <ul className="admin-campaign-help-list">
          {ADMIN_CAMPAIGN_SECTION_SPECS.map((spec) => (
            <li key={spec.type}>
              <code>{spec.type}</code> — {spec.label}
              {': '}
              {spec.fields.length === 0
                ? '추가 키 없음'
                : spec.fields.map((field) => (
                  `${field.key}${field.required ? '' : '(선택)'}`
                )).join(', ')}
            </li>
          ))}
        </ul>
        <p className="muted" style={{ fontSize: 12, lineHeight: 1.7, margin: 0 }}>
          <code>exchange</code> 블록의 <code>offer_id</code>는 아래 카드팩 교환처 목록의 ID를
          복사해 넣습니다. <code>goods</code>의 <code>good_ids</code>는 굿즈 ID 1~8개,
          {' '}<code>notice</code>의 <code>items</code>는 문구 1~20줄입니다.
        </p>
        <pre className="admin-campaign-help-sample">
{`[
  { "type": "intro", "copy": "출석하고 카드팩을 받아 가세요" },
  { "type": "attendance", "anchor": "attend" },
  { "type": "exchange", "offer_id": "00000000-0000-0000-0000-000000000000" },
  { "type": "goods", "good_ids": ["g13", "g14"] },
  { "type": "notice", "items": ["교환한 카드팩은 되돌릴 수 없습니다."] }
]`}
        </pre>
      </div>
    </details>
  );
}

function CampaignEditor({
  action,
  pending,
  selected,
  state,
}: {
  action: (formData: FormData) => void;
  pending: boolean;
  selected: AdminCampaignRecord | null;
  state: AdminCampaignActionState;
}) {
  /* 서버 왕복 전에 같은 규칙으로 한 번 본다. 20블록짜리 JSON에서 쉼표 하나를
     서버 응답으로 확인하는 왕복은 편집을 포기하게 만든다. */
  const [sectionsError, setSectionsError] = useState<string | null>(null);
  const sectionsMessage = sectionsError ?? state.errors?.sections;

  return (
    <form
      action={action}
      className="card col"
      onSubmit={(event) => {
        const raw = new FormData(event.currentTarget).get('sections');
        const parsed = parseAdminCampaignSections(typeof raw === 'string' ? raw : '');
        if (parsed.ok) {
          setSectionsError(null);
          return;
        }
        setSectionsError(parsed.message);
        event.preventDefault();
      }}
      style={{ borderRadius: 10, gap: 14, padding: 16 }}
    >
      <input name="previousId" type="hidden" value={selected?.id ?? ''} />
      <div className="admin-form-grid">
        <Field
          defaultValue={selected?.id ?? ''}
          error={state.errors?.id}
          label="ID (URL 슬러그 · 소문자·숫자·하이픈)"
          name="id"
          placeholder="autumn-attendance"
          readOnly={Boolean(selected)}
          required
        />
        <SelectField
          defaultValue={selected?.kind ?? 'event'}
          error={state.errors?.kind}
          label="종류"
          name="kind"
        >
          {ADMIN_CAMPAIGN_KINDS.map((kind) => (
            <option key={kind} value={kind}>{ADMIN_CAMPAIGN_KIND_LABELS[kind]}</option>
          ))}
        </SelectField>
        <Field
          defaultValue={selected?.title ?? ''}
          error={state.errors?.title}
          label="제목"
          name="title"
          placeholder="가을 출석 이벤트"
          required
        />
        <Field
          defaultValue={selected?.subtitle ?? ''}
          error={state.errors?.subtitle}
          label="부제 (선택, 200자 이하)"
          name="subtitle"
          placeholder="매일 출석하고 코인을 모으세요"
        />
        <SelectField
          defaultValue={selected?.status ?? 'draft'}
          error={state.errors?.status}
          label="상태 (종료 처리도 여기서)"
          name="status"
        >
          {ADMIN_CAMPAIGN_STATUSES.map((status) => (
            <option key={status} value={status}>{ADMIN_CAMPAIGN_STATUS_LABELS[status]}</option>
          ))}
        </SelectField>
        <Field
          defaultValue={selected?.featuredOrder ?? ''}
          error={state.errors?.featuredOrder}
          label="배너 순서 (비우면 허브 배너 미노출)"
          min={1}
          name="featuredOrder"
          step={1}
          type="number"
        />
        <Field
          defaultValue={adminCampaignDateTimeInput(selected?.startsAt)}
          error={state.errors?.startsAt}
          label="시작 (KST)"
          name="startsAt"
          required
          type="datetime-local"
        />
        <Field
          defaultValue={adminCampaignDateTimeInput(selected?.endsAt)}
          error={state.errors?.endsAt}
          label="종료 (KST)"
          name="endsAt"
          required
          type="datetime-local"
        />
        <Field
          defaultValue={selected?.heroImagePath ?? ''}
          error={state.errors?.heroImagePath}
          label="상세 히어로 이미지 경로"
          name="heroImagePath"
          placeholder="campaigns/autumn/hero.webp"
        />
        <Field
          defaultValue={selected?.cardImagePath ?? ''}
          error={state.errors?.cardImagePath}
          label="목록 카드 이미지 경로"
          name="cardImagePath"
          placeholder="campaigns/autumn/card.webp"
        />
        <Field
          defaultValue={selected?.bannerImagePath ?? ''}
          error={state.errors?.bannerImagePath}
          label="허브 배너 이미지 경로"
          name="bannerImagePath"
          placeholder="campaigns/autumn/banner.webp"
        />
      </div>

      <div className="admin-campaign-sections col" style={{ gap: 8 }}>
        <TextArea
          defaultValue={adminCampaignSectionsInput(selected?.sections)}
          label="랜딩 구성 (sections JSON · 비우면 본문 없음)"
          name="sections"
          placeholder='[{ "type": "intro", "copy": "..." }]'
        />
        <ErrorText id={sectionsMessage ? 'campaign-sections-error' : undefined}>
          {sectionsMessage}
        </ErrorText>
        <SectionSchemaHelp />
      </div>

      {selected && (
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>
          블록 {selected.sections.length}개 · 최근 수정 {adminCampaignDateTimeInput(selected.updatedAt).replace('T', ' ')} (KST)
        </p>
      )}
      <FormShell pending={pending} state={state} />
    </form>
  );
}

export function CampaignSection({
  action,
  onSelect,
  pending,
  records,
  selected,
  state,
}: {
  action: (formData: FormData) => void;
  onSelect: (record: { id: string } | null) => void;
  pending: boolean;
  records: AdminCampaignRecord[];
  selected: AdminCampaignRecord | null;
  state: AdminCampaignActionState;
}) {
  return (
    <div className="col" style={{ gap: 14 }}>
      <p className="muted" style={{ fontSize: 12, lineHeight: 1.7, margin: 0 }}>
        캠페인은 이벤트 허브(<code>/events</code>)와 상세 페이지가 읽는 편성 단위입니다.
        오프라인 팝업 예매(이벤트 카탈로그)와는 다른 도메인이라 슬러그가 서로 겹칠 수 없습니다.
        상태를 <strong>종료</strong>로 바꾸면 진행 중 목록에서 내려갑니다.
      </p>
      <div className="admin-master-detail">
        <RecordList
          activeId={selected?.id ?? null}
          ariaLabel="캠페인 목록"
          emptyMessage="등록된 캠페인이 없습니다."
          items={records}
          labelFor={campaignListLabel}
          newLabel="새 캠페인"
          onNew={() => onSelect(null)}
          onSelect={onSelect}
        />
        <CampaignEditor
          action={action}
          key={selected ? `${selected.id}:${selected.updatedAt}` : 'new-campaign'}
          pending={pending}
          selected={selected}
          state={state}
        />
      </div>
    </div>
  );
}
