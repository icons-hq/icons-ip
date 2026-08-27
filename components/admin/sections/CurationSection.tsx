'use client';

import Link from 'next/link';
import { useActionState, useMemo, useState } from 'react';
import { upsertAdminCurationAction } from '@/app/admin/curation-actions';
import type { AdminCurationActionState, AdminCurationKind } from '@/lib/admin/curations';
import type { AdminCurationRecord } from '@/lib/admin/curations.server';
import type { AdminCurationTargetRecord } from '@/lib/admin/curation-targets';
import { adminCurationTargetGroupsFor } from '@/lib/admin/curation-targets';
import { ArtworkUploadField } from '../ArtworkUploadField';
import { ErrorText, Field, FormShell, RecordList, SelectField } from '../fields';

const emptyState: AdminCurationActionState = {};

const KIND_LABELS: Record<AdminCurationKind, string> = {
  hero: '홈 히어로',
  featured_ip: '특집 IP',
  announcement: '공지 배너',
  notice_strip: '공지 스트립',
  editor_pick: '에디터의 제안',
  band_banner: '기획전 밴드',
  best_tab: 'BEST 탭',
  benefit: '혜택 타일',
};

/* 이미지 없이는 렌더할 수 없는 편성 — 제거 버튼을 숨겨 저장 실패를 미리 막는다. */
const IMAGE_REQUIRED_KINDS = new Set<AdminCurationKind>([
  'hero',
  'notice_strip',
  'editor_pick',
  'band_banner',
]);

const STATUS_LABELS: Record<AdminCurationRecord['status'], string> = {
  active: '노출 중',
  scheduled: '노출 예정',
  ended: '종료',
  inactive: '비활성',
};

const ARTWORK_GUIDANCE: Record<AdminCurationKind, string> = {
  hero: '히어로 이미지는 필수입니다.',
  featured_ip: '특집 IP 이미지는 선택입니다. 비우면 IP 키아트를 사용합니다.',
  announcement: '공지 배너 이미지는 선택입니다.',
  notice_strip: '공지 스트립 이미지는 필수입니다.',
  editor_pick: '에디터의 제안 카드 이미지는 필수입니다.',
  band_banner: '기획전 배너 이미지는 필수입니다.',
  best_tab: 'BEST 탭은 이미지를 쓰지 않습니다.',
  benefit: '혜택 타일은 이미지를 쓰지 않습니다.',
};

/* payload 는 kind 별로 키가 다른 jsonb 라 폼 초기값은 값 모양을 확인하고 읽는다. */
function payloadText(selected: AdminCurationRecord | null, key: string) {
  const value = selected?.payload?.[key];
  return typeof value === 'string' ? value : '';
}

function payloadGoodIds(selected: AdminCurationRecord | null) {
  const value = selected?.payload?.good_ids;
  if (!Array.isArray(value)) return '';
  return value.filter((goodId): goodId is string => typeof goodId === 'string').join(', ');
}

function toKstDateTimeInput(value: string | null) {
  if (!value) return '';
  const instant = Date.parse(value);
  if (Number.isNaN(instant)) return '';
  return new Date(instant + 9 * 60 * 60 * 1_000).toISOString().slice(0, 16);
}

function formatKstDateTime(value: string | null) {
  if (!value) return '종료 없음';
  return `${toKstDateTimeInput(value).replace('T', ' ')} KST`;
}

function renderCurationLabel(record: AdminCurationRecord) {
  return (
    <span className="admin-curation-record">
      <strong className="admin-curation-record-title">{record.title}</strong>
      <span className="admin-curation-record-meta">
        <span>{KIND_LABELS[record.kind]} · {STATUS_LABELS[record.status]} · 순서 {record.displayOrder}</span>
        <span>{formatKstDateTime(record.activeFrom)} → {formatKstDateTime(record.activeTo)}</span>
      </span>
    </span>
  );
}

export function getCurationFormKey(
  selected: AdminCurationRecord | null,
  draftId: string,
  operationId: string,
) {
  return JSON.stringify([selected?.id ?? draftId, selected?.updatedAt ?? null, operationId]);
}

export function CurationSection({
  draftActiveFrom,
  draftId,
  eventOptions,
  goodOptions,
  ipOptions,
  onSelect,
  operationId,
  records,
  selected,
}: {
  draftActiveFrom: string;
  draftId: string;
  eventOptions: AdminCurationTargetRecord[];
  goodOptions: AdminCurationTargetRecord[];
  ipOptions: AdminCurationTargetRecord[];
  onSelect: (curation: AdminCurationRecord | null) => void;
  operationId: string;
  records: AdminCurationRecord[];
  selected: AdminCurationRecord | null;
}) {
  return (
    <section aria-labelledby="admin-curation-heading" className="admin-curation-console col">
      <header className="admin-curation-heading">
        <div>
          <span className="mono">홈 편성 운영</span>
          <h2 id="admin-curation-heading">홈 큐레이션</h2>
          <p>공개 홈의 히어로와 공지 스트립부터 에디터의 제안, 기획전, BEST 탭, 혜택 타일까지 홈 편성의 노출 순서와 기간을 관리합니다.</p>
        </div>
        {/* 공지 발송이 별도 라우트가 되면서 부모 상태 전환 콜백이 링크가 됐다. */}
        <Link className="btn btn-ghost admin-curation-notification-cta" href="/admin/messaging/notifications">
          인앱 공지는 공지 발송에서 별도 발송
        </Link>
      </header>

      <div className="admin-master-detail">
        <RecordList
          activeId={selected?.id ?? null}
          ariaLabel="홈 큐레이션 목록"
          emptyMessage="등록된 홈 큐레이션이 없습니다."
          itemClassName="admin-curation-record-button"
          items={records}
          labelFor={renderCurationLabel}
          newLabel="새 홈 큐레이션"
          onNew={() => onSelect(null)}
          onSelect={onSelect}
          thumbnailKind="curation"
          thumbnailUrlFor={(curation) => curation.imageUrl}
        />
        <CurationForm
          draftActiveFrom={draftActiveFrom}
          draftId={draftId}
          eventOptions={eventOptions}
          goodOptions={goodOptions}
          ipOptions={ipOptions}
          key={getCurationFormKey(selected, draftId, operationId)}
          operationId={operationId}
          selected={selected}
        />
      </div>
    </section>
  );
}

function CurationForm({
  draftActiveFrom,
  draftId,
  eventOptions,
  goodOptions,
  ipOptions,
  operationId,
  selected,
}: {
  draftActiveFrom: string;
  draftId: string;
  eventOptions: AdminCurationTargetRecord[];
  goodOptions: AdminCurationTargetRecord[];
  ipOptions: AdminCurationTargetRecord[];
  operationId: string;
  selected: AdminCurationRecord | null;
}) {
  const [state, action, pending] = useActionState(upsertAdminCurationAction, emptyState);
  const [kind, setKind] = useState<AdminCurationKind>(selected?.kind ?? 'hero');
  const ipTitles = useMemo(
    () => new Map(ipOptions.map((ip) => [ip.id, ip.title])),
    [ipOptions],
  );
  const linkTargetGroups = useMemo(
    () => adminCurationTargetGroupsFor(
      { events: eventOptions, goods: goodOptions, ips: ipOptions },
      selected?.linkPath ?? null,
    ),
    [eventOptions, goodOptions, ipOptions, selected?.linkPath],
  );

  return (
    <form action={action} className="card col admin-curation-form">
      <input name="operationId" type="hidden" value={operationId} />
      <input name="id" type="hidden" value={selected?.id ?? draftId} />

      <div className="admin-curation-window" role="status">
        <span className="mono">운영 윈도</span>
        <strong>
          {KIND_LABELS[kind]} · {selected ? STATUS_LABELS[selected.status] : '신규'} · 순서 {selected?.displayOrder ?? 0}
        </strong>
        <span>{formatKstDateTime(selected?.activeFrom ?? draftActiveFrom)} → {formatKstDateTime(selected?.activeTo ?? null)}</span>
      </div>

      <div className="admin-form-grid">
        <SelectField
          error={state.errors?.kind}
          label="홈에 보일 영역"
          name="kind"
          onChange={(event) => setKind(event.target.value as AdminCurationKind)}
          required
          value={kind}
        >
          <option value="hero">홈 히어로</option>
          <option value="featured_ip">특집 IP</option>
          <option value="announcement">공지 배너</option>
          <option value="notice_strip">공지 스트립</option>
          <option value="editor_pick">에디터의 제안</option>
          <option value="band_banner">기획전 밴드</option>
          <option value="best_tab">BEST 탭</option>
          <option value="benefit">혜택 타일</option>
        </SelectField>
        {kind === 'featured_ip' && (
          <SelectField
            defaultValue={selected?.ipId ?? ''}
            error={state.errors?.ipId}
            label="특집할 IP"
            name="ipId"
            required
          >
            <option value="">IP 선택</option>
            {ipOptions.map((ip) => (
              <option disabled={Boolean(ip.archivedAt)} key={ip.id} value={ip.id}>
                {ip.archivedAt ? `[보관] ${ip.title}` : ip.title}
              </option>
            ))}
          </SelectField>
        )}
        {kind === 'best_tab' && (
          <SelectField
            defaultValue={selected?.slot ?? ''}
            error={state.errors?.slot}
            label="탭 슬롯"
            name="slot"
            required
          >
            <option value="">슬롯 선택</option>
            <option value="category">카테고리 BEST</option>
            <option value="popular">인기템</option>
          </SelectField>
        )}
        <Field
          defaultValue={selected?.title}
          error={state.errors?.title}
          label="홈에 보일 제목"
          name="title"
          required
        />
        {kind === 'hero' && (
          <Field
            defaultValue={payloadText(selected, 'subtitle')}
            error={state.errors?.subtitle}
            label="히어로 부제 (선택)"
            name="subtitle"
          />
        )}
        {kind === 'editor_pick' && (
          <>
            <Field
              defaultValue={payloadText(selected, 'badge')}
              error={state.errors?.badge}
              label="배지 문구 (선택)"
              name="badge"
            />
            <Field
              defaultValue={payloadText(selected, 'description')}
              error={state.errors?.description}
              label="카드 설명 (선택)"
              name="description"
            />
          </>
        )}
        {kind === 'band_banner' && (
          <>
            <Field
              defaultValue={payloadText(selected, 'subcopy')}
              error={state.errors?.subcopy}
              label="서브카피 (선택)"
              name="subcopy"
            />
            <Field
              defaultValue={payloadGoodIds(selected)}
              error={state.errors?.goodIds}
              label="연결 상품 ID (쉼표 구분, 최대 4개)"
              name="goodIds"
              placeholder="g13, g14"
            />
          </>
        )}
        {kind === 'best_tab' && (
          <Field
            defaultValue={payloadGoodIds(selected)}
            error={state.errors?.goodIds}
            label="연결 상품 ID (쉼표 구분, 최대 12개)"
            name="goodIds"
            placeholder="g13, g14"
            required
          />
        )}
        {kind === 'benefit' && (
          <Field
            defaultValue={payloadText(selected, 'description')}
            error={state.errors?.description}
            label="타일 설명 (선택)"
            name="description"
          />
        )}
        {/* 경로 자유입력을 화면 선택으로 바꿨다 (#183) — 오타가 404를 만들 수 없다. */}
        <SelectField
          defaultValue={selected?.linkPath ?? '/'}
          error={state.errors?.linkPath}
          label="눌렀을 때 이동할 화면"
          name="linkPath"
          required
        >
          {linkTargetGroups.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.options.map((option) => (
                <option key={option.path} value={option.path}>{option.label}</option>
              ))}
            </optgroup>
          ))}
        </SelectField>
        <Field
          defaultValue={selected?.displayOrder ?? 0}
          error={state.errors?.displayOrder}
          label="노출 순서"
          min={0}
          name="displayOrder"
          required
          step={1}
          type="number"
        />
        <Field
          defaultValue={toKstDateTimeInput(selected?.activeFrom ?? draftActiveFrom)}
          error={state.errors?.activeFrom}
          label="노출 시작 (KST)"
          name="activeFrom"
          required
          type="datetime-local"
        />
        <Field
          defaultValue={toKstDateTimeInput(selected?.activeTo ?? null)}
          error={state.errors?.activeTo}
          label="노출 종료 (KST, 선택)"
          name="activeTo"
          type="datetime-local"
        />
        <label className="row admin-curation-enabled">
          <input defaultChecked={selected?.enabled ?? true} name="enabled" type="checkbox" />
          <span>홈 노출 활성화</span>
        </label>
      </div>

      <ArtworkUploadField
        allowRemove={!IMAGE_REQUIRED_KINDS.has(kind)}
        currentPath={selected?.imagePath ?? null}
        currentUrl={selected?.imageUrl ?? null}
        helpText={ARTWORK_GUIDANCE[kind]}
        kind="curation"
      />
      <ErrorText id={state.errors?.imagePath ? 'curation-image-error' : undefined}>
        {state.errors?.imagePath}
      </ErrorText>
      {/* 히어로(5:6 세로 크롭)와 공지 스트립(모바일 60px 비율)은 모바일 전용 아트워크를
          payload 로 하나 더 싣는다 — PC 비율 이미지는 모바일 폭에서 붕괴한다(R-01·R-02). */}
      {(kind === 'hero' || kind === 'notice_strip') && (
        <>
          <ArtworkUploadField
            allowRemove
            currentPath={payloadText(selected, 'mobile_image_path') || null}
            currentUrl={selected?.mobileImageUrl ?? null}
            fieldId="curation-mobile"
            helpText={kind === 'hero'
              ? '모바일 히어로 이미지는 선택입니다. 비우면 데스크톱 이미지를 그대로 씁니다.'
              : '모바일 스트립 이미지는 선택입니다. 비우면 데스크톱 이미지를 그대로 씁니다.'}
            kind="curation"
            label="모바일 아트워크 파일"
            name="mobileImagePath"
          />
          <ErrorText id={state.errors?.mobileImagePath ? 'curation-mobile-image-error' : undefined}>
            {state.errors?.mobileImagePath}
          </ErrorText>
        </>
      )}
      {kind === 'featured_ip' && selected?.ipId && (
        <p className="admin-curation-ip-note">
          현재 특집 IP: {ipTitles.get(selected.ipId) ?? selected.ipId}
        </p>
      )}
      <FormShell pending={pending} state={state} />
    </form>
  );
}
