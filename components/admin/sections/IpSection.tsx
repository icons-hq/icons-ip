'use client';

import { useActionState, useState } from 'react';
import type { AdminCatalogActionState } from '@/app/admin/actions';
import { saveAdminIpHallBannerAction, type AdminIpHallBannerActionState } from '@/app/admin/ip-banner-actions';
import type { AdminIpRecord } from '@/lib/admin/catalog.server';
import { adminFormRemountKey, preservedFormValues, resolveArtworkDefault, resolveFieldDefault } from '@/lib/admin/form-state';
import { withLocalRecoveryValues } from '@/lib/admin/local-autosave';
import { ADMIN_IP_PUBLISH_STATE_LABELS, adminIpPublishState, formatAdminIpRecordLabel } from '@/lib/admin/ip-publish';
import { statusTone } from '@/lib/admin/status-tone';
import { publicMediaUrl } from '@/lib/media';
import {
  adminCatalogArchiveCounts,
  filterAdminCatalogRecords,
  type AdminCatalogArchiveFilter,
} from '../../../lib/admin/catalog-archive';
import type { CatalogSnapshot } from '@/lib/catalog';
import { Check } from 'lucide-react';
import { Button } from '@/components/admin/kit/ui/button';
import { AdminFormGrid } from '../console/AdminKit';
import { ArtworkUploadField } from '../ArtworkUploadField';
import { CatalogArchiveControl, CatalogArchiveFilter } from '../CatalogArchiveControls';
import { IpPublishControl, IpPublishStateBadge } from '../IpPublishControls';
import { ActionNotice, ErrorText, Field, RecordList, SelectField, TextArea } from '../fields';
import { AdminLocalDraftNotice } from '../AdminLocalDraftNotice';
import { useAdminLocalAutosave } from '../useAdminLocalAutosave';
import { FormGroup, MasterDetail, SECTION_CARD, SectionHeading } from './SectionLayout';
import { RecordStatusLabel } from './RecordStatusLabel';

const LOCAL_DRAFT_FIELDS = ['id', 'title', 'sub', 'verticalKey', 'tagline', 'glyph', 'synopsis', 'imagePath'] as const;
const EMPTY_BANNER_STATE: AdminIpHallBannerActionState = {};

/*
 * IP관 PC/MO 배너(11 IP-06 · L8b). 기본정보 폼과 따로 저장한다(admin_save_ip_hall_banner) — 저장된 IP 에만 보인다.
 * 둘 다 선택이고, 비우면 공개 IP관은 키아트를 배경으로 쓴다. 모바일 배너가 없으면 모바일에서도 PC 배너를 쓴다.
 */
export function IpHallBannerForm({ ip }: { ip: AdminIpRecord }) {
  const [state, action, pending] = useActionState(saveAdminIpHallBannerAction, EMPTY_BANNER_STATE);
  return (
    <form action={action} aria-label="IP관 배너" className={SECTION_CARD} key={`${ip.id}:${ip.hallBannerImagePath ?? ''}:${ip.hallBannerMobileImagePath ?? ''}`}>
      <SectionHeading
        description="온라인 팝업 IP관 맨 위 배너 그림입니다. 비워 두면 IP 키아트를 씁니다. IP 이름·설명·해시태그는 그림 위에 글자로 얹히니 그림에 넣지 마세요."
        title="IP관 배너"
      />
      <input name="ipId" type="hidden" value={ip.id} />
      <ArtworkUploadField
        allowRemove
        currentPath={ip.hallBannerImagePath ?? null}
        currentUrl={ip.hallBannerImageUrl ?? null}
        fieldId="ip-hall-banner-pc"
        helpText="PC 배너는 2880×1080px(화면 1440×540)를 권장합니다. 가운데를 기준으로 잘립니다. 왼쪽 약 560px는 글자가 서며 어둡게 깔리니 주요 그림은 오른쪽에 두세요."
        kind="ip"
        label="PC 배너"
        name="hallBannerImagePath"
        showCropGuide={false}
        showPath={Boolean(ip.hallBannerImagePath)}
      />
      <ErrorText>{state.errors?.imagePath}</ErrorText>
      <ArtworkUploadField
        allowRemove
        currentPath={ip.hallBannerMobileImagePath ?? null}
        currentUrl={ip.hallBannerMobileImageUrl ?? null}
        fieldId="ip-hall-banner-mobile"
        helpText="모바일 배너는 750×840px(화면 375×420)를 권장합니다. 글자가 가운데에 서고 그림 전체가 어둡게 깔립니다. 비우면 모바일에서도 PC 배너를 씁니다."
        kind="ip"
        label="모바일 배너"
        name="hallBannerMobileImagePath"
        showCropGuide={false}
        showPath={Boolean(ip.hallBannerMobileImagePath)}
      />
      <ErrorText>{state.errors?.mobileImagePath}</ErrorText>
      <ActionNotice state={state} />
      <div className="flex flex-wrap items-center gap-2">
        <Button className="min-w-36" disabled={pending} type="submit">
          <Check aria-hidden="true" /> {pending ? '저장 중' : 'IP관 배너 저장'}
        </Button>
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

  const detail = (
    <>
      <AdminLocalDraftNotice
        onDiscard={discard}
        onRestore={restore}
        pending={pending}
        recovery={Boolean(localDraft.recovery) && !preservedFormValues(state, selected?.id)}
        unavailable={localDraft.unavailable}
      />
      <form action={action} className={SECTION_CARD} key={formKey} onSubmitCapture={onSubmitCapture} ref={formRef}>
        {/* IP 작업 화면은 머리에 같은 게시 상태 배지가 있어 폼 맨 위에 다시 두지 않는다. */}
        {selected && hideRecordList ? null : <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">게시 상태</span>
          <IpPublishStateBadge state={publishState} />
          {!selected && (
            <span className="text-sm text-muted-foreground">새 IP는 초안으로 시작합니다. 공개 전까지는 어디에도 노출되지 않습니다.</span>
          )}
        </div>}
        <input name="previousId" type="hidden" value={selected?.id ?? ''} />
        <FormGroup title="기본 정보">
          <AdminFormGrid>
            <Field defaultValue={field('id')} error={state.errors?.id} label="IP 코드 · ID (필수)" name="id" placeholder="rilakkuma" readOnly={Boolean(selected)} />
            <Field defaultValue={field('title')} error={state.errors?.title} label="IP 이름 (필수)" name="title" placeholder="리락쿠마" />
            <Field defaultValue={field('sub')} label="보조 설명" name="sub" placeholder="San-X · 캐릭터 IP" />
            <SelectField defaultValue={field('verticalKey')} error={state.errors?.verticalKey} label="IP 분류 (필수)" name="verticalKey">
              <option value="">선택</option>
              {verticals.map((vertical) => (
                <option key={vertical.key} value={vertical.key}>{vertical.label}</option>
              ))}
            </SelectField>
            <input name="featured" type="hidden" value={field('featured')} />
          </AdminFormGrid>
        </FormGroup>
        {/* 소개와 그림을 나란히 두어 한 화면에 입력이 끝나고 저장 줄이 그림 상자를 덮지 않는다. */}
        <div className="grid min-w-0 items-start gap-x-6 gap-y-4 border-t pt-4 lg:grid-cols-2">
          <FormGroup bare hint="모두 선택 입력이며 공개 IP관 화면의 소개에 쓰입니다." title="소개 글">
            <Field defaultValue={field('tagline')} label="한 줄 소개 · 태그라인" name="tagline" />
            <TextArea
              defaultValue={field('glyph')}
              label="크게 쓰는 글자 (줄바꿈 가능)"
              name="glyph"
              placeholder={'홍실\n퀘스트'}
            />
            <TextArea defaultValue={field('synopsis')} label="자세한 소개" name="synopsis" />
          </FormGroup>
          <FormGroup bare title="대표 이미지">
            {/* 배경 CSS 자유입력을 운영자 폼에서 뺐다 (#183). 아트워크가 없는 레거시
                레코드는 이 값으로 렌더되므로 그대로 실어 보내 보존한다. */}
            <input name="bg" type="hidden" value={field('bg')} />
            <ArtworkUploadField
              autoUpload
              currentPath={artwork.currentPath}
              currentUrl={artwork.currentUrl}
              helpText="키아트는 IP를 대표하는 가로형 그림입니다. 온라인 팝업·홈·IP 카드에 쓰이니 가로형 이미지를 올려주세요."
              kind="ip"
              label="키아트 이미지"
              showPath={Boolean(artwork.currentPath)}
            />
          </FormGroup>
        </div>
        <ActionNotice state={state} />
        {/* 입력 칸이 많아 저장 버튼이 첫 화면 밖으로 밀린다 — 폼을 보는 동안 카드 아래쪽에 붙어 따라온다. 상품 등록과 같이 오른쪽에 둔다. */}
        <div className="sticky bottom-0 z-10 -mx-4 -mb-4 flex flex-wrap items-center justify-end gap-2 rounded-b-xl border-t bg-card px-4 py-3 sm:-mx-5 sm:-mb-5 sm:px-5" data-admin-savebar="">
          {offersPublish ? (
            <>
              <Button className="min-w-36" disabled={pending} name="intent" type="submit" value="draft" variant="outline">
                <Check aria-hidden="true" /> {pending ? '저장 중' : '초안으로 저장'}
              </Button>
              <Button className="min-w-36" disabled={pending} name="intent" type="submit" value="publish">
                <Check aria-hidden="true" /> {pending ? '저장 중' : '저장 후 공개'}
              </Button>
            </>
          ) : (
            <Button className="min-w-36" disabled={pending} name="intent" type="submit" value="save">
              <Check aria-hidden="true" /> {pending ? '저장 중' : '저장'}
            </Button>
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
    </>
  );

  if (hideRecordList) return <div className="flex min-w-0 flex-col gap-4">{detail}</div>;

  return (
    <MasterDetail
      list={(
        <>
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
            ariaLabel="IP 목록"
            items={visibleRecords}
            labelFor={(ip) => <RecordStatusLabel name={`${ip.id} · ${ip.title}`} status={ADMIN_IP_PUBLISH_STATE_LABELS[adminIpPublishState(ip)]} tone={statusTone('publication', adminIpPublishState(ip))} title={formatAdminIpRecordLabel(`${ip.id} · ${ip.title}`, ip)} />}
            onNew={() => onSelect(null)}
            onSelect={onSelect}
            thumbnailKind="ip"
            thumbnailUrlFor={(ip) => ip.imageUrl}
          />
        </>
      )}
    >
      {detail}
    </MasterDetail>
  );
}
