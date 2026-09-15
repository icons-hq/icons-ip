'use client';

import { GOODS_GALLERY_MAX } from '@/lib/admin/catalog';
import type { AdminCatalogActionState } from '@/app/admin/actions';
import { useState } from 'react';
import { ArtworkUploadField, COMMON_ARTWORK_GUIDANCE } from './ArtworkUploadField';
import { ErrorText } from './fields';

/**
 * 갤러리 슬롯은 번호가 곧 공개 상세페이지의 노출 순서다. 슬롯 교체·제거는
 * 각 ArtworkUploadField가 맡고, 성공한 업로드 경로는 각 hidden input으로 폼에
 * 남긴다. 부모가 저장 계약을 바꾸지 않아도 슬롯별 실패를 격리할 수 있다.
 */
export function GoodsGalleryFields({
  galleryPaths,
  galleryUrls,
  onPreviewChange,
  state,
}: {
  galleryPaths: string[];
  galleryUrls: string[];
  onPreviewChange: (name: string, url: string | null) => void;
  state: AdminCatalogActionState;
}) {
  const [slotPaths, setSlotPaths] = useState(() => Array.from(
    { length: GOODS_GALLERY_MAX },
    (_, slot) => galleryPaths[slot] ?? '',
  ));

  return <fieldset className="wc-admin-gallery-fields">
    <legend className="mono">갤러리 (최대 {GOODS_GALLERY_MAX}장)</legend>
    <p className="wc-admin-gallery-fields__intro">슬롯 번호 순서대로 상세페이지에 표시됩니다. 비워둔 슬롯은 건너뜁니다. 각 파일은 선택 즉시 업로드되며, 업로드 완료와 상품 저장 후 공개 반영은 별도입니다.</p>
    <p className="wc-admin-gallery-fields__guidance" id="goods-gallery-upload-guidance">공통 파일 규격: {COMMON_ARTWORK_GUIDANCE}</p>
    <div className="wc-admin-gallery-fields__slots">
      {Array.from({ length: GOODS_GALLERY_MAX }, (_, slot) => {
        const name = `galleryPath${slot}`;
        const hasPath = Boolean(slotPaths[slot]);
        return <div className="wc-admin-gallery-slot" data-gallery-slot={slot + 1} key={slot}>
          <div className="wc-admin-gallery-slot__heading">
            <div><strong>슬롯 {slot + 1} · 갤러리 {slot + 1}</strong><span>상세페이지 노출 순서 {slot + 1}</span></div>
            <span className="wc-admin-gallery-slot__state">{hasPath ? '현재 연결됨' : '비어 있음'}</span>
          </div>
          <ArtworkUploadField
            autoUpload
            allowRemove
            ariaDescribedBy="goods-gallery-upload-guidance"
            compact
            currentPath={slotPaths[slot] || null}
            currentUrl={galleryUrls[slot] || null}
            fieldId={`good-gallery-${slot}`}
            kind="good"
            label={`갤러리 ${slot + 1} 이미지`}
            name={name}
            onPreviewChange={(url) => onPreviewChange(name, url)}
            onPathChange={(path) => setSlotPaths((current) => current.map((value, index) => index === slot ? path : value))}
            showCropGuide={false}
            showGuidance={false}
            showPath={false}
          />
          <ErrorText id={`${name}-error`}>{state.errors?.[name]}</ErrorText>
        </div>;
      })}
    </div>
  </fieldset>;
}
