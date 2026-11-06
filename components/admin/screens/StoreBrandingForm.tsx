'use client';
import { useState, useTransition, type FormEvent } from 'react';
import { saveStoreBrandingAction, type StoreBrandingActionState } from '@/app/admin/store-branding-actions';
import { ArtworkUploadField } from '@/components/admin/ArtworkUploadField';
import { AdminField, AdminFormGrid } from '@/components/admin/console/AdminKit';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { StoreBrandFooterDetails, StoreBrandLogo } from '@/components/shell/StoreBranding';
import type { StoreSettingsSnapshot } from '@/lib/admin/store-settings';
import { publicMediaUrl } from '@/lib/media';
import { DEFAULT_STORE_BRANDING, STORE_SOCIAL_LABELS, STORE_SOCIAL_PLATFORMS, parseStoreBranding, storefrontBranding, type StoreBranding } from '@/lib/store-branding';

const GROUP = 'flex min-w-0 flex-col gap-5 rounded-lg border p-4 sm:p-5';
/* float 하면 legend가 테두리 선 위가 아니라 상자 안 첫 줄(제목)로 선다. */
const LEGEND = 'float-left mb-1 w-full text-sm font-semibold text-foreground';
const CHECK = 'inline-flex min-h-9 w-fit items-center gap-2 text-sm';

export function StoreBrandingForm({ settings, canEdit, operationId }: { settings: StoreSettingsSnapshot; canEdit: boolean; operationId: string }) {
  const [draft, setDraft] = useState<StoreBranding>(settings.branding ?? DEFAULT_STORE_BRANDING);
  // A refreshed server prop must not advance a draft made against an older row.
  const [editingStamp, setEditingStamp] = useState(settings.updatedAt);
  const [saveOperationId, setSaveOperationId] = useState(operationId);
  const [state, setState] = useState<StoreBrandingActionState>({});
  const [pending, startTransition] = useTransition();
  function change(update: Partial<StoreBranding>) {
    setDraft(previous => ({ ...previous, ...update }));
    setSaveOperationId(crypto.randomUUID());
    setState({});
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit || pending) return;
    // Keep native form state, including verified upload paths, on every failure.
    const values = new FormData(event.currentTarget);
    const payload = { ...draft, displayName: draft.displayName.trim(), introduction: draft.introduction.trim(),
      profileImagePath: String(values.get('profileImagePath') || '') || null,
      logoPath: String(values.get('logoPath') || '') || null, mobileLogoPath: String(values.get('mobileLogoPath') || '') || null,
      socials: Object.fromEntries(STORE_SOCIAL_PLATFORMS.map(platform => [platform, { ...draft.socials[platform], url: draft.socials[platform].url.trim() }])) };
    startTransition(async () => {
      try {
        const result = await saveStoreBrandingAction(payload, editingStamp, saveOperationId);
        setState(result);
        if (result.updatedAt) {
          setEditingStamp(result.updatedAt);
          setSaveOperationId(crypto.randomUUID());
          const saved = parseStoreBranding(payload);
          if (saved) setDraft(saved);
        }
      } catch {
        // Transport errors happen before the server's structured error response.
        // Keep the same request id so retry also recovers a committed response.
        setState({ error: '저장 결과를 확인하지 못했습니다. 입력값을 유지한 채 다시 저장해주세요.' });
      }
    });
  }
  const parsed = parseStoreBranding({ ...draft, displayName: draft.displayName.trim(), introduction: draft.introduction.trim() });
  const preview = parsed ? storefrontBranding(parsed, path => publicMediaUrl(path) ?? '') : null;
  /* 스토어 브랜드·SNS 입력(템플릿 룩, ADR-0028). 묶음마다 테두리 상자와 제목을 두고, 입력은 kit 부품이다. */
  return <form onSubmit={submit} className="flex min-w-0 flex-col gap-5">
    <p className="text-sm text-muted-foreground">스토어 헤더와 푸터에 표시할 이름·로고와 푸터의 대표 이미지·소개·SNS를 설정합니다. 사업자 정보는 별도 설정에서 관리합니다.</p>
    <fieldset disabled={pending || !canEdit} className={GROUP}>
      <legend className={LEGEND}>스토어 표시</legend>
      <AdminFormGrid>
        <AdminField label="스토어 표시 이름" inputId="brand-display-name" hint="최대 30자. 이미지 로고의 대체 설명에도 사용합니다.">
          <Input id="brand-display-name" value={draft.displayName} onChange={event => change({ displayName: event.target.value })} required aria-describedby="brand-display-name-hint" />
        </AdminField>
        <AdminField label="로고 표시 방식" inputId="brand-logo-mode">
          <NativeSelect className="w-full" id="brand-logo-mode" value={draft.logoMode} onChange={event => change({ logoMode: event.target.value as StoreBranding['logoMode'] })}>
            <option value="text">텍스트</option><option value="image">이미지</option>
          </NativeSelect>
        </AdminField>
      </AdminFormGrid>
      <AdminFormGrid>
        <ArtworkUploadField key={`pc-${editingStamp}`} allowRemove autoUpload compact kind="curation" label="PC 로고" name="logoPath" fieldId="brand-pc-logo" currentPath={draft.logoPath} currentUrl={draft.logoPath ? publicMediaUrl(draft.logoPath) : null}
          showCropGuide={false} showPath={false} helpText="이미지 표시에는 PC 로고가 필요합니다. 원본 비율을 유지해 표시합니다." onPathChange={path => change({ logoPath: path || null })} />
        <ArtworkUploadField key={`mobile-${editingStamp}`} allowRemove autoUpload compact kind="curation" label="모바일 로고" name="mobileLogoPath" fieldId="brand-mobile-logo" currentPath={draft.mobileLogoPath} currentUrl={draft.mobileLogoPath ? publicMediaUrl(draft.mobileLogoPath) : null}
          showCropGuide={false} showPath={false} helpText="비워두면 모바일에서도 PC 로고를 표시합니다." onPathChange={path => change({ mobileLogoPath: path || null })} />
      </AdminFormGrid>
      <ArtworkUploadField key={`profile-${editingStamp}`} allowRemove autoUpload compact kind="curation" label="스토어 대표 이미지" name="profileImagePath" fieldId="brand-profile-image" currentPath={draft.profileImagePath ?? null} currentUrl={draft.profileImagePath ? publicMediaUrl(draft.profileImagePath) : null}
        showCropGuide={false} showPath={false} helpText="160×160px 이상의 정사각형, 1300×1300px 권장. 최대 5MB의 JPG·PNG·WebP를 사용할 수 있습니다. 푸터에 80×80px로 표시하며 PC·모바일 로고와 별도로 저장합니다." onPathChange={path => change({ profileImagePath: path || null })} />
      <AdminField label="스토어 소개" inputId="brand-introduction" hint={`${[...draft.introduction].length}/50자 · 푸터에 표시합니다.`}>
        <Input id="brand-introduction" value={draft.introduction} onChange={event => change({ introduction: event.target.value })} aria-describedby="brand-introduction-hint" />
      </AdminField>
      <label className={CHECK}><input type="checkbox" checked={draft.showIntroduction} onChange={event => change({ showIntroduction: event.target.checked })} /> 스토어 소개 노출</label>
    </fieldset>
    <fieldset disabled={pending || !canEdit} className={GROUP}>
      <legend className={LEGEND}>SNS 연결</legend>
      <p className="text-sm text-muted-foreground">켜진 SNS만 푸터에 표시하며 새 창으로 열립니다. 네이버 블로그·페이스북·인스타그램의 HTTPS 주소를 입력해주세요.</p>
      {STORE_SOCIAL_PLATFORMS.map(platform => <AdminField key={platform} label={`${STORE_SOCIAL_LABELS[platform]} 주소`} inputId={`brand-${platform}`}>
        <Input id={`brand-${platform}`} type="url" value={draft.socials[platform].url} maxLength={2048} onChange={event => change({ socials: { ...draft.socials, [platform]: { ...draft.socials[platform], url: event.target.value } } })} />
        <label className={CHECK}><input type="checkbox" checked={draft.socials[platform].enabled} onChange={event => change({ socials: { ...draft.socials, [platform]: { ...draft.socials[platform], enabled: event.target.checked } } })} /> {STORE_SOCIAL_LABELS[platform]} 노출</label>
      </AdminField>)}
    </fieldset>
    <section aria-label="브랜드 표시 미리보기" className="flex min-w-0 flex-col gap-3 rounded-lg border p-4 sm:p-5">
      <h3 className="text-sm font-semibold">표시 미리보기</h3>
      {preview ? <><StoreBrandLogo branding={preview} /><StoreBrandFooterDetails branding={preview} /></> : <p className="text-sm text-muted-foreground">입력값과 노출 설정을 확인하면 미리보기가 표시됩니다.</p>}
    </section>
    {state.error ? <p className="text-sm text-destructive" role="alert">{state.error}</p> : null}
    {state.message ? <p className="text-sm text-[var(--wc-success)]" role="status">{state.message}</p> : null}
    {canEdit ? <Button className="self-start" type="submit" disabled={pending}>{pending ? '저장 중…' : '브랜드·SNS 저장'}</Button> : <p className="text-sm text-muted-foreground">직원(staff)은 조회할 수 있습니다. 변경은 관리자(admin)에게 요청해주세요.</p>}
  </form>;
}
