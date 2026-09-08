'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  ADMIN_ARTWORK_ACCEPT,
  adminArtworkAspectRatio,
  normalizeAdminArtworkMetadata,
  type AdminArtworkKind,
} from '../../lib/admin/artwork';
import { uploadAdminArtwork } from '../../lib/admin/artwork-upload.client';
import {
  artworkGuideLabel,
  artworkSizeWarning,
  type ArtworkSizeGuide,
} from '../../lib/admin/artwork-guidance';

const CURRENT_PREVIEW_ALT = '현재 아트워크 미리보기';
const SELECTED_PREVIEW_ALT = '선택한 아트워크 미리보기';
const UPLOADED_PREVIEW_ALT = '업로드된 아트워크 미리보기';
const UPLOAD_VALIDITY_MESSAGE = '이미지를 먼저 업로드해주세요.';

export interface ArtworkDisplayState {
  committedAlt: string;
  committedUrl: string | null;
  imagePath: string;
  previewAlt: string;
  previewUrl: string | null;
}

export function createArtworkDisplayState(
  currentPath: string | null,
  currentUrl: string | null,
): ArtworkDisplayState {
  return {
    committedAlt: CURRENT_PREVIEW_ALT,
    committedUrl: currentUrl,
    imagePath: currentPath ?? '',
    previewAlt: CURRENT_PREVIEW_ALT,
    previewUrl: currentUrl,
  };
}

export function clearArtworkDisplayState(
  state: ArtworkDisplayState,
): ArtworkDisplayState {
  return {
    committedAlt: state.committedAlt,
    committedUrl: null,
    imagePath: '',
    previewAlt: state.committedAlt,
    previewUrl: null,
  };
}

export function showSelectedArtworkPreview(
  state: ArtworkDisplayState,
  selectedUrl: string,
): ArtworkDisplayState {
  return {
    ...state,
    previewAlt: SELECTED_PREVIEW_ALT,
    previewUrl: selectedUrl,
  };
}

export function commitSelectedArtworkPreview(
  state: ArtworkDisplayState,
  imagePath: string,
): ArtworkDisplayState {
  return {
    committedAlt: UPLOADED_PREVIEW_ALT,
    committedUrl: state.previewUrl,
    imagePath,
    previewAlt: UPLOADED_PREVIEW_ALT,
    previewUrl: state.previewUrl,
  };
}

export function restoreCommittedArtworkPreview(
  state: ArtworkDisplayState,
): ArtworkDisplayState {
  return {
    ...state,
    previewAlt: state.committedAlt,
    previewUrl: state.committedUrl,
  };
}

/*
 * 한 폼에 같은 kind 의 업로드 칸이 여러 개 놓일 수 있다 (#172 굿즈 갤러리).
 * name 은 제출 필드, fieldId 는 label·aria 연결용 접두다. 기본값은 kind 라서
 * 칸이 하나뿐인 기존 섹션들의 마크업은 그대로다.
 *
 * onPreviewChange 는 지금 보이는 이미지 URL 을 바깥에 알린다 (#184 미리보기).
 * 저장 전 미리보기가 목적이라 업로드 전 선택한 파일의 object URL 도 함께 넘긴다.
 */
export function ArtworkUploadField({
  allowRemove = false,
  currentPath,
  currentUrl,
  fieldId,
  helpText,
  kind,
  label = '아트워크 파일',
  name = 'imagePath',
  onPreviewChange,
  recommended,
}: {
  allowRemove?: boolean;
  currentPath: string | null;
  currentUrl: string | null;
  fieldId?: string;
  helpText?: string;
  kind: AdminArtworkKind;
  label?: string;
  name?: string;
  onPreviewChange?: (url: string | null) => void;
  /** 권장 규격. 어긋나도 **막지 않고** 한 줄 알려 준다(현업 슬라이스 5). */
  recommended?: ArtworkSizeGuide;
}) {
  const [display, setDisplay] = useState(() => createArtworkDisplayState(currentPath, currentUrl));
  const [error, setError] = useState<string>();
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string>();
  const [sizeWarning, setSizeWarning] = useState<string>();
  const committedObjectUrlRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedObjectUrlRef = useRef<string | null>(null);

  function revokeCommittedObjectUrl() {
    if (committedObjectUrlRef.current) {
      URL.revokeObjectURL(committedObjectUrlRef.current);
      committedObjectUrlRef.current = null;
    }
  }

  function revokeSelectedObjectUrl() {
    if (selectedObjectUrlRef.current) {
      URL.revokeObjectURL(selectedObjectUrlRef.current);
      selectedObjectUrlRef.current = null;
    }
  }

  useEffect(() => () => {
    revokeCommittedObjectUrl();
    revokeSelectedObjectUrl();
  }, []);

  function clearFileInput() {
    if (!fileInputRef.current) return;
    fileInputRef.current.setCustomValidity('');
    fileInputRef.current.value = '';
  }

  function restoreCommittedPreview() {
    revokeSelectedObjectUrl();
    setDisplay((current) => restoreCommittedArtworkPreview(current));
    onPreviewChange?.(display.committedUrl);
  }

  function handleSelectionCancel() {
    if (pending) return;
    setError(undefined);
    setFile(null);
    setStatus(undefined);
    clearFileInput();
    restoreCommittedPreview();
  }

  function handleRemove() {
    if (pending || !display.imagePath) return;
    revokeCommittedObjectUrl();
    revokeSelectedObjectUrl();
    setError(undefined);
    setFile(null);
    clearFileInput();
    setDisplay((current) => clearArtworkDisplayState(current));
    setStatus('저장하면 현재 이미지 연결을 제거합니다.');
    onPreviewChange?.(null);
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    if (pending) {
      event.currentTarget.value = '';
      return;
    }

    const selected = event.currentTarget.files?.[0] ?? null;
    setError(undefined);
    setStatus(undefined);

    if (!selected) {
      setFile(null);
      setSizeWarning(undefined);
      event.currentTarget.setCustomValidity('');
      restoreCommittedPreview();
      return;
    }

    const metadata = normalizeAdminArtworkMetadata({
      kind,
      mimeType: selected.type,
      size: selected.size,
    });
    if (!metadata.ok) {
      setError(metadata.error);
      setFile(null);
      setSizeWarning(undefined);
      event.currentTarget.setCustomValidity('');
      restoreCommittedPreview();
      event.currentTarget.value = '';
      return;
    }

    revokeSelectedObjectUrl();
    const objectUrl = URL.createObjectURL(selected);
    selectedObjectUrlRef.current = objectUrl;
    setFile(selected);
    setDisplay((current) => showSelectedArtworkPreview(current, objectUrl));
    checkRecommendedSize(objectUrl);
    setStatus('업로드 전 미리보기입니다. 확인 후 업로드해주세요.');
    event.currentTarget.setCustomValidity(UPLOAD_VALIDITY_MESSAGE);
    onPreviewChange?.(objectUrl);
  }

  /* 규격 확인은 브라우저가 그림을 다 읽은 뒤에야 가능하다 — 그래서 비동기고,
     실패하면 조용히 넘어간다(읽지 못한 것을 「틀렸다」고 말하지 않는다). */
  function checkRecommendedSize(objectUrl: string) {
    setSizeWarning(undefined);
    if (!recommended) return;

    const probe = new Image();
    probe.onload = () => {
      setSizeWarning(
        artworkSizeWarning(recommended, { width: probe.naturalWidth, height: probe.naturalHeight })
          ?? undefined,
      );
    };
    probe.src = objectUrl;
  }

  async function handleUpload() {
    if (!file || pending) return;

    setError(undefined);
    setPending(true);
    setStatus(undefined);
    const result = await uploadAdminArtwork({ kind, file });
    setPending(false);

    if (!result.ok) {
      setError(result.error);
      setFile(null);
      clearFileInput();
      restoreCommittedPreview();
      return;
    }

    revokeCommittedObjectUrl();
    committedObjectUrlRef.current = selectedObjectUrlRef.current;
    selectedObjectUrlRef.current = null;
    setDisplay((current) => commitSelectedArtworkPreview(current, result.imagePath));
    setFile(null);
    setStatus('이미지를 업로드했습니다. 아래 저장 버튼을 눌러 카탈로그에 적용해주세요.');
    clearFileInput();
  }

  const idPrefix = fieldId ?? kind;
  const errorId = `${idPrefix}-artwork-error`;
  const guidanceId = `${idPrefix}-artwork-guidance`;
  const helpId = `${idPrefix}-artwork-help`;
  const describedBy = [helpId, helpText ? guidanceId : null, error ? errorId : null]
    .filter(Boolean)
    .join(' ');

  return (
    <section
      className="card col"
      data-artwork-kind={kind}
      style={{ borderRadius: 10, gap: 12, padding: 14 }}
    >
      <div className="row admin-artwork-layout" style={{ alignItems: 'flex-start', gap: 14, justifyContent: 'flex-start' }}>
        <div
          className="admin-artwork-preview"
          style={{
            alignItems: 'center',
            aspectRatio: adminArtworkAspectRatio(kind),
            background: 'rgba(255,255,255,.035)',
            border: '1px solid var(--line)',
            borderRadius: 10,
            display: 'flex',
            flex: '0 0 min(220px, 42%)',
            justifyContent: 'center',
            minHeight: 110,
            overflow: 'hidden',
          }}
        >
          {display.previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt={display.previewAlt}
              src={display.previewUrl}
              style={{ height: '100%', objectFit: 'cover', width: '100%' }}
            />
          ) : (
            <span className="mono" style={{ color: 'var(--faint)', fontSize: 12 }}>이미지 없음</span>
          )}
        </div>
        <div className="col admin-artwork-controls" style={{ flex: 1, gap: 8, minWidth: 0 }}>
          <label className="col" style={{ color: 'var(--dim)', fontSize: 13, gap: 7 }}>
            {label}
            <input
              accept={ADMIN_ARTWORK_ACCEPT}
              aria-disabled={pending || undefined}
              aria-describedby={describedBy}
              aria-invalid={Boolean(error)}
              className="admin-artwork-input"
              data-upload-validity-message={UPLOAD_VALIDITY_MESSAGE}
              onChange={handleFileChange}
              onClick={(event) => {
                if (pending) event.preventDefault();
              }}
              ref={fileInputRef}
              type="file"
              style={{ color: 'var(--dim)', fontFamily: 'inherit', fontSize: 12, width: '100%' }}
            />
          </label>
          <span className="mono" id={helpId} style={{ color: 'var(--faint)', fontSize: 12 }}>
            JPEG, PNG, WebP · 최대 5MB · 가로·세로 최대 8192px · 총 4,000만 픽셀 이하 · 애니메이션 제외
          </span>
          {recommended && (
            <span className="mono" style={{ color: 'var(--dim)', fontSize: 12 }}>
              {artworkGuideLabel(recommended)}
            </span>
          )}
          {helpText && <span id={guidanceId} style={{ color: 'var(--dim)', fontSize: 12 }}>{helpText}</span>}
          {/* 경고이지 오류가 아니다 — role="status" 로 읽히고, 업로드 단추는 그대로 열려 있다. */}
          {sizeWarning && (
            <span role="status" style={{ color: 'var(--dim)', fontSize: 12, lineHeight: 1.6 }}>{sizeWarning}</span>
          )}
          <div className="row admin-artwork-actions" style={{ flexWrap: 'wrap', justifyContent: 'flex-start' }}>
            <button
              className="btn btn-ghost admin-artwork-upload"
              disabled={!file || pending}
              onClick={handleUpload}
              type="button"
            >
              {pending ? '업로드 중' : display.imagePath ? '이미지 교체' : '이미지 업로드'}
            </button>
            <button
              className="btn btn-ghost"
              disabled={!file || pending}
              onClick={handleSelectionCancel}
              type="button"
            >
              선택 취소
            </button>
            {allowRemove && (
              <button
                className="btn btn-ghost admin-artwork-remove"
                disabled={!display.imagePath || pending}
                onClick={handleRemove}
                type="button"
              >
                이미지 제거
              </button>
            )}
          </div>
        </div>
      </div>
      <input name={name} readOnly type="hidden" value={display.imagePath} />
      <div className="mono" style={{ color: 'var(--faint)', fontSize: 12, overflowWrap: 'anywhere' }}>
        현재 경로: {display.imagePath || '없음'}
      </div>
      {error && (
        <span id={errorId} role="alert" style={{ color: 'var(--pink)', fontSize: 12, fontWeight: 700 }}>
          {error}
        </span>
      )}
      {status && <span aria-live="polite" role="status" style={{ color: 'var(--mint)', fontSize: 12 }}>{status}</span>}
    </section>
  );
}
