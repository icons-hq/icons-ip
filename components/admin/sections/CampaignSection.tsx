'use client';

import { adminGoodsCopy } from '@/lib/admin/vocabulary';
import { AdminFormGrid, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { statusTone } from '@/lib/admin/status-tone';
import { useState } from 'react';
import type { AdminCampaignActionState } from '@/app/admin/campaign-actions';
import { CAMPAIGN_CTA_LABEL_MAX_LENGTH } from '@/lib/campaigns';
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
import { SettingsFormGroup } from '../screens/StoreSettingsFormGroup';

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
    <span className="flex min-w-0 flex-col gap-0.5 text-left">
      {/* 작성 중과 종료는 같은 회색 배지다 — 끝난 캠페인은 제목까지 물러나 준비 중인 것과 갈린다. */}
      <strong className={`truncate text-[13px] font-medium${campaign.status === 'ended' ? ' text-muted-foreground' : ''}`}>{campaign.title}</strong>
      <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground">
        <AdminStatusBadge tone={statusTone('campaign', campaign.status)}>{ADMIN_CAMPAIGN_STATUS_LABELS[campaign.status]}</AdminStatusBadge>
        {ADMIN_CAMPAIGN_KIND_LABELS[campaign.kind]}
        {campaign.featuredOrder ? ` · 배너 ${campaign.featuredOrder}` : ''}
      </span>
      <span className="text-[11px] text-muted-foreground tabular-nums">{campaignPeriodLabel(campaign)}</span>
    </span>
  );
}

/* 본문 안 code 조각(필드 이름·경로)의 모양. code 요소에는 클래스를 달지 않고 부모가 입힌다. */
const CODE = '[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em] [&_code]:text-foreground';
const NOTE = 'm-0 text-xs leading-relaxed text-muted-foreground';

/** 블록 스키마 안내. 직접 편집이 계약이면 계약서가 화면에 있어야 한다. */
function SectionSchemaHelp() {
  return (
    <details className={`group rounded-lg border bg-muted/40 px-3.5 py-3 text-sm ${CODE}`}>
      <summary className="cursor-pointer font-medium">구성 코드 작성 방법 (블록 {ADMIN_CAMPAIGN_SECTION_SPECS.length}종)</summary>
      <div className="mt-2 flex flex-col gap-2">
        <p className={NOTE}>
          최상위는 블록 배열이고 최대 {ADMIN_CAMPAIGN_MAX_SECTIONS}개까지입니다. 모든 블록은
          {' '}<code>type</code>이 필수이고 <code>anchor</code>(1~20자, 상세 목차 링크)를 선택으로
          받습니다. 목록에 없는 키는 저장되지 않습니다 — 오타는 조용히 통과하는 대신 거절됩니다.
          이 화면은 블록 편집기가 아니라 JSON 직접 편집이 v1 계약입니다.
        </p>
        <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed text-muted-foreground">
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
        <p className={NOTE}>
          <code>exchange</code> 블록의 <code>offer_id</code>는 아래 카드팩 교환처 목록의 ID를
          복사해 넣습니다. <code>goods</code>의 <code>good_ids</code>{adminGoodsCopy("는 굿즈 ID 1~8개, ")}{' '}<code>notice</code>의 <code>items</code>는 문구 1~20줄입니다.
        </p>
        <p className={NOTE}>
          <code>coupon</code>의 <code>coupon_code</code>는 쿠폰 관리에 먼저 등록되어 있어야 해요 —
          등록되지 않은 코드는 저장 단계에서 거절됩니다.
        </p>
        <p className={NOTE}>
          <code>cta</code>는 이동 버튼입니다. <code>label</code>은 버튼 문구(1~{CAMPAIGN_CTA_LABEL_MAX_LENGTH}자),
          {' '}<code>href</code>는 <code>/</code>로 시작하는 ICONS 내부 경로(예: <code>/shop</code>,
          {' '}<code>/events/autumn-attendance</code>)만 받습니다. 외부 주소(<code>https://…</code>,
          {' '}<code>{'//…'}</code>), 공백·역슬래시가 든 주소, <code>.</code>·<code>..</code> 경로 조각은 저장되지 않습니다.
        </p>
        <pre className="overflow-x-auto rounded-md border bg-background p-3 font-mono text-xs leading-relaxed">
{`[
  { "type": "intro", "copy": "출석하고 카드팩을 받아 가세요" },
  { "type": "attendance", "anchor": "attend" },
  { "type": "exchange", "offer_id": "00000000-0000-0000-0000-000000000000" },
  { "type": "goods", "good_ids": ["g13", "g14"] },
  { "type": "cta", "label": "쇼핑하러 가기", "href": "/shop" },
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
      className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4 text-sm text-card-foreground sm:p-5"
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
    >
      <input name="previousId" type="hidden" value={selected?.id ?? ''} />
      {/* 오른쪽이 새로 만드는 중인지 고치는 중인지 첫눈에 읽히게 한다. */}
      <header className="flex min-w-0 flex-wrap items-center gap-2">
        <h3 className="min-w-0 truncate text-base font-semibold text-foreground">{selected ? selected.title : '새 캠페인'}</h3>
        {selected
          ? <AdminStatusBadge tone={statusTone('campaign', selected.status)}>{ADMIN_CAMPAIGN_STATUS_LABELS[selected.status]}</AdminStatusBadge>
          : <AdminStatusBadge tone="info">새로 등록</AdminStatusBadge>}
        <span className="ml-auto text-xs text-muted-foreground">{selected ? '선택한 캠페인을 수정합니다.' : '왼쪽 목록에서 고르면 수정할 수 있습니다.'}</span>
      </header>
      <SettingsFormGroup description="캠페인 주소는 등록 후 바꿀 수 없고, 이벤트 카탈로그의 오프라인 팝업 예매 주소와 겹칠 수 없습니다." title="기본 정보">
      <AdminFormGrid>
        <Field
          defaultValue={selected?.id ?? ''}
          error={state.errors?.id}
          label="캠페인 주소 (영문 소문자·숫자·하이픈)"
          name="id"
          placeholder="예: autumn-attendance"
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
          placeholder="예: 가을 출석 이벤트"
          required
        />
        <Field
          defaultValue={selected?.subtitle ?? ''}
          error={state.errors?.subtitle}
          label="부제 (선택, 200자 이하)"
          name="subtitle"
          placeholder="예: 매일 출석하고 코인을 모으세요"
        />
      </AdminFormGrid>
      </SettingsFormGroup>
      <SettingsFormGroup title="공개 설정">
      <AdminFormGrid>
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
          label="배너 순서 (비우면 이벤트 목록 배너 미노출)"
          min={1}
          name="featuredOrder"
          step={1}
          type="number"
        />
        <Field
          defaultValue={adminCampaignDateTimeInput(selected?.startsAt)}
          error={state.errors?.startsAt}
          label="시작 (한국 시각)"
          name="startsAt"
          required
          type="datetime-local"
        />
        <Field
          defaultValue={adminCampaignDateTimeInput(selected?.endsAt)}
          error={state.errors?.endsAt}
          label="종료 (한국 시각)"
          name="endsAt"
          required
          type="datetime-local"
        />
      </AdminFormGrid>
      </SettingsFormGroup>
      <SettingsFormGroup title="이미지">
      <AdminFormGrid>
        <Field
          defaultValue={selected?.heroImagePath ?? ''}
          error={state.errors?.heroImagePath}
          label="상세 상단 이미지 경로"
          name="heroImagePath"
          placeholder="예: campaigns/autumn/hero.webp"
        />
        <Field
          defaultValue={selected?.cardImagePath ?? ''}
          error={state.errors?.cardImagePath}
          label="목록 카드 이미지 경로"
          name="cardImagePath"
          placeholder="예: campaigns/autumn/card.webp"
        />
        <Field
          defaultValue={selected?.bannerImagePath ?? ''}
          error={state.errors?.bannerImagePath}
          label="이벤트 목록 배너 이미지 경로"
          name="bannerImagePath"
          placeholder="예: campaigns/autumn/banner.webp"
        />
      </AdminFormGrid>
      </SettingsFormGroup>

      <SettingsFormGroup title="랜딩 구성">
      <div className="flex flex-col gap-2 [&_textarea]:min-h-40 [&_textarea]:font-mono [&_textarea]:text-[12.5px] [&_textarea]:leading-relaxed">
        <TextArea
          defaultValue={adminCampaignSectionsInput(selected?.sections)}
          label="구성 코드 (비우면 본문 없음)"
          name="sections"
          placeholder='예: [{ "type": "intro", "copy": "..." }]'
        />
        <ErrorText id={sectionsMessage ? 'campaign-sections-error' : undefined}>
          {sectionsMessage}
        </ErrorText>
        <SectionSchemaHelp />
      </div>
      </SettingsFormGroup>

      {/* 폼이 화면보다 길어도 저장은 늘 첫 화면 바닥에 있다. */}
      <div className="sticky bottom-0 z-10 -mx-4 -mb-4 flex flex-wrap items-center justify-end gap-3 rounded-b-xl border-t bg-card px-4 py-3 sm:-mx-5 sm:-mb-5 sm:px-5 [&>[role]]:mr-auto" data-admin-savebar="">
        {selected && (
          <p className="mr-auto text-xs text-muted-foreground">
            블록 {selected.sections.length}개 · 최근 수정 {adminCampaignDateTimeInput(selected.updatedAt).replace('T', ' ')} (한국 시각)
          </p>
        )}
        <FormShell pending={pending} state={state} />
      </div>
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
    <div className="flex min-w-0 flex-col gap-4">
      <p className={NOTE}>
        캠페인은 고객 화면의 이벤트 목록과 상세 페이지에 노출됩니다.
        상태를 <strong className="font-medium text-foreground">종료</strong>로 바꾸면 진행 중 목록에서 내려갑니다.
      </p>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(240px,0.34fr)_minmax(0,1fr)] [&>*]:min-w-0">
        <RecordList
          activeId={selected?.id ?? null}
          ariaLabel="캠페인 목록"
          emptyMessage="등록된 캠페인이 없습니다."
          itemClassName="aria-[current=true]:ring-1 aria-[current=true]:ring-primary"
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
