'use client';

import { useActionState, useState } from 'react';
import type { AdminCatalogActionState } from '@/app/admin/actions';
import { saveAdminIpHallBannerAction, type AdminIpHallBannerActionState } from '@/app/admin/ip-banner-actions';
import type { AdminIpRecord } from '@/lib/admin/catalog.server';
import { adminFormRemountKey, preservedFormValues, resolveArtworkDefault, resolveFieldDefault } from '@/lib/admin/form-state';
import { withLocalRecoveryValues } from '@/lib/admin/local-autosave';
import { adminIpPublishState, formatAdminIpRecordLabel } from '@/lib/admin/ip-publish';
import { publicMediaUrl } from '@/lib/media';
import {
  adminCatalogArchiveCounts,
  filterAdminCatalogRecords,
  type AdminCatalogArchiveFilter,
} from '../../../lib/admin/catalog-archive';
import type { CatalogSnapshot } from '@/lib/catalog';
import { Icon } from '@/components/ui/Icon';
import { ArtworkUploadField } from '../ArtworkUploadField';
import { CatalogArchiveControl, CatalogArchiveFilter } from '../CatalogArchiveControls';
import { IpPublishControl, IpPublishStateBadge } from '../IpPublishControls';
import { ActionNotice, ErrorText, Field, RecordList, SelectField, TextArea } from '../fields';
import { AdminLocalDraftNotice } from '../AdminLocalDraftNotice';
import { useAdminLocalAutosave } from '../useAdminLocalAutosave';

const LOCAL_DRAFT_FIELDS = ['id', 'title', 'sub', 'verticalKey', 'tagline', 'glyph', 'synopsis', 'imagePath'] as const;
const EMPTY_BANNER_STATE: AdminIpHallBannerActionState = {};

/*
 * IP관 PC/MO 배너(11 IP-06 · L8b). 기본정보 폼과 따로 저장한다(admin_save_ip_hall_banner) — 저장된 IP 에만 보인다.
 * 둘 다 선택이고, 비우면 공개 IP관은 키아트를 배경으로 쓴다. 모바일 배너가 없으면 모바일에서도 PC 배너를 쓴다.
 */
export function IpHallBannerForm({ ip }: { ip: AdminIpRecord }) {
  const [state, action, pending] = useActionState(saveAdminIpHallBannerAction, EMPTY_BANNER_STATE);
  return (
    <form action={action} aria-label="IP관 배너" className="card col" key={`${ip.id}:${ip.hallBannerImagePath ?? ''}:${ip.hallBannerMobileImagePath ?? ''}`} style={{ gap: 14, padding: 18 }}>
      <div className="col" style={{ gap: 4 }}>
        <strong>IP관 배너</strong>
        <span className="muted" style={{ fontSize: 12 }}>
          온라인 팝업 IP관 맨 위 배너 그림입니다. 비워 두면 IP 키아트를 씁니다. IP 이름·설명·해시태그는 그림 위에 글자로 얹히니 그림에 넣지 마세요.
        </span>
      </div>
      <input name="ipId" type="hidden" value={ip.id} />
      <ArtworkUploadField
        allowRemove
        currentPath={ip.hallBannerImagePath ?? null}
        currentUrl={ip.hallBannerImageUrl ?? null}
        fieldId="ip-hall-banner-pc"
        helpText="PC 배너는 2880×1080px(화면 1440×540)를 권장합니다. 가운데를 기준으로 잘립니다."
        kind="ip"
        label="PC 배너"
        name="hallBannerImagePath"
        showCropGuide={false}
      />
      <ErrorText>{state.errors?.imagePath}</ErrorText>
      <ArtworkUploadField
        allowRemove
        currentPath={ip.hallBannerMobileImagePath ?? null}
        currentUrl={ip.hallBannerMobileImageUrl ?? null}
        fieldId="ip-hall-banner-mobile"
        helpText="모바일 배너는 750×840px(화면 375×420)를 권장합니다. 비우면 모바일에서도 PC 배너를 씁니다."
        kind="ip"
        label="모바일 배너"
        name="hallBannerMobileImagePath"
        showCropGuide={false}
      />
      <ErrorText>{state.errors?.mobileImagePath}</ErrorText>
      <ActionNotice state={state} />
      <div className="row" style={{ justifyContent: 'flex-start' }}>
        <button className="btn btn-holo" disabled={pending} style={{ minWidth: 150 }} type="submit">
          <Icon name="check" size={15} /> {pending ? '저장 중' : 'IP관 배너 저장'}
        </button>
      </div>
    </form>
  );
}

export function IpSection({
  accountId,
  hideRecordList = false,
  action,
  onSelect,
  pending,
  records,
  selected,
  state,
  verticals,
}: {
  accountId: string;
  hideRecordList?: boolean;
  action: (payload: FormData) => void;
  onSelect: (ip: AdminIpRecord | null) => void;
  pending: boolean;
  records: AdminIpRecord[];
  selected: AdminIpRecord | null;
  state: AdminCatalogActionState;
  verticals: CatalogSnapshot['verticals'];
}) {
  const [archiveFilter, setArchiveFilter] = useState<AdminCatalogArchiveFilter>(
    selected?.archivedAt ? 'archived' : 'active',
  );
  const visibleRecords = filterAdminCatalogRecords(records, archiveFilter);
  const { snapshot: localDraft, formRef, onSubmitCapture, restore, discard, scopeKey } = useAdminLocalAutosave({
    scope: { accountId, formId: 'ip', recordId: selected?.id ?? null },
    fields: LOCAL_DRAFT_FIELDS,
    serverState: state,
  });
  const inputState = withLocalRecoveryValues(state, selected?.id ?? null, localDraft.restoredValues);

  /*
   * 모든 입력은 비제어 defaultValue 다. 저장이 실패하면 액션이 제출값을 `state.values` 로
   * 되돌려주고, 폼 key 에 섞인 `state.attempt` 가 바뀌어 리마운트되면서 그 값이 다시
   * 심긴다 — 타이핑한 값도, 업로드해 둔 아트워크 경로도 사라지지 않는다.
   */
  const field = (key: string) => resolveFieldDefault(inputState, selected, key);
  const artwork = resolveArtworkDefault(inputState, selected, publicMediaUrl);
  const formKey = `${scopeKey}:${adminFormRemountKey(state, selected)}:${localDraft.revision}`;

  /*
   * 게시 상태 (20260907130000). 새 IP 와 초안은 "초안으로 저장"·"저장 후 공개" 두 동선을,
   * 공개·보관된 IP 는 상태를 건드리지 않는 "저장" 하나를 갖는다 — 폼 저장이 조용히
   * 비공개로 바꾸는 일이 없게, 초안으로 되돌리기는 옆의 전환 컨트롤에만 둔다.
   */
  const publishState = selected ? adminIpPublishState(selected) : 'draft';
  const offersPublish = publishState === 'draft';

  return (
    <div className={hideRecordList ? undefined : 'admin-master-detail'}>
      {!hideRecordList ? <div className="col" style={{ gap: 12, minWidth: 0 }}>
        <CatalogArchiveFilter
          counts={adminCatalogArchiveCounts(records)}
          filter={archiveFilter}
          onChange={(filter) => {
            setArchiveFilter(filter);
            if (selected && !filterAdminCatalogRecords([selected], filter).length) onSelect(null);
          }}
        />
        <RecordList
          activeId={selected?.id ?? null}
          items={visibleRecords}
          labelFor={(ip) => formatAdminIpRecordLabel(`${ip.id} · ${ip.title}`, ip)}
          onNew={() => onSelect(null)}
          onSelect={onSelect}
          thumbnailKind="ip"
          thumbnailUrlFor={(ip) => ip.imageUrl}
        />
      </div> : null}
      <div className="col" style={{ gap: 16, minWidth: 0 }}>
        <AdminLocalDraftNotice
          onDiscard={discard}
          onRestore={restore}
          pending={pending}
          recovery={Boolean(localDraft.recovery) && !preservedFormValues(state, selected?.id)}
          unavailable={localDraft.unavailable}
        />
        <form action={action} className="card col" key={formKey} onSubmitCapture={onSubmitCapture} ref={formRef} style={{ gap: 14, padding: 18 }}>
          <div className="row" style={{ gap: 10 }}>
            <span className="mono" style={{ color: 'var(--dim)', fontSize: 11 }}>게시 상태</span>
            <IpPublishStateBadge state={publishState} />
            {!selected && (
              <span className="muted" style={{ fontSize: 12 }}>새 IP는 초안으로 시작합니다. 공개 전까지는 어디에도 노출되지 않습니다.</span>
            )}
          </div>
          <input name="previousId" type="hidden" value={selected?.id ?? ''} />
          <div className="admin-form-grid">
            <Field defaultValue={field('id')} error={state.errors?.id} label="ID" name="id" placeholder="rilakkuma" readOnly={Boolean(selected)} />
            <Field defaultValue={field('title')} error={state.errors?.title} label="IP 이름" name="title" placeholder="리락쿠마" />
            <Field defaultValue={field('sub')} label="보조 설명" name="sub" placeholder="San-X · 캐릭터 IP" />
            <SelectField defaultValue={field('verticalKey')} error={state.errors?.verticalKey} label="버티컬" name="verticalKey">
              <option value="">선택</option>
              {verticals.map((vertical) => (
                <option key={vertical.key} value={vertical.key}>{vertical.label}</option>
              ))}
            </SelectField>
            <Field defaultValue={field('tagline')} label="태그라인" name="tagline" />
            <TextArea
              defaultValue={field('glyph')}
              label="글리프 (줄바꿈 가능)"
              name="glyph"
              placeholder={'홍실\n퀘스트'}
            />
            <input name="featured" type="hidden" value={field('featured')} />
          </div>
          <TextArea defaultValue={field('synopsis')} label="시놉시스" name="synopsis" />
          {/* 배경 CSS 자유입력을 운영자 폼에서 뺐다 (#183). 아트워크가 없는 레거시
              레코드는 이 값으로 렌더되므로 그대로 실어 보내 보존한다. */}
          <input name="bg" type="hidden" value={field('bg')} />
          <ArtworkUploadField
            currentPath={artwork.currentPath}
            currentUrl={artwork.currentUrl}
            helpText="IP 키아트는 가로형 이미지를 사용해주세요."
            kind="ip"
          />
          <ActionNotice state={state} />
          <div className="row" style={{ flexWrap: 'wrap', gap: 10, justifyContent: 'flex-start' }}>
            {offersPublish ? (
              <>
                <button className="btn btn-ghost" disabled={pending} name="intent" style={{ minWidth: 150 }} value="draft">
                  <Icon name="check" size={15} /> {pending ? '저장 중' : '초안으로 저장'}
                </button>
                <button className="btn btn-holo" disabled={pending} name="intent" style={{ minWidth: 150 }} value="publish">
                  <Icon name="check" size={15} /> {pending ? '저장 중' : '저장 후 공개'}
                </button>
              </>
            ) : (
              <button className="btn btn-holo" disabled={pending} name="intent" style={{ minWidth: 150 }} value="save">
                <Icon name="check" size={15} /> {pending ? '저장 중' : '저장'}
              </button>
            )}
          </div>
        </form>
        {selected && <IpHallBannerForm ip={selected} key={selected.id} />}
        {selected && (
          <IpPublishControl
            id={selected.id}
            key={`${selected.id}:${publishState}`}
            record={selected}
          />
        )}
        {selected && (
          <CatalogArchiveControl
            archivedAt={selected.archivedAt}
            id={selected.id}
            key={`${selected.id}:${selected.archivedAt ?? 'active'}`}
            kind="ip"
          />
        )}
      </div>
    </div>
  );
}
