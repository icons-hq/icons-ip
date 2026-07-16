'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  ADMIN_ARTWORK_ACCEPT,
  normalizeAdminArtworkMetadata,
  type AdminArtworkKind,
} from '../../lib/admin/artwork';
import { uploadAdminArtwork } from '../../lib/admin/artwork-upload.client';

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

export function ArtworkUploadField({
  currentPath,
  currentUrl,
  helpText,
  kind,
}: {
  currentPath: string | null;
  currentUrl: string | null;
  helpText?: string;
  kind: AdminArtworkKind;
}) {
  const [display, setDisplay] = useState(() => createArtworkDisplayState(currentPath, currentUrl));
  const [error, setError] = useState<string>();
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string>();
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
  }

  function handleSelectionCancel() {
    if (pending) return;
    setError(undefined);
    setFile(null);
    setStatus(undefined);
    clearFileInput();
    restoreCommittedPreview();
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
    setStatus('업로드 전 미리보기입니다. 확인 후 업로드해주세요.');
    event.currentTarget.setCustomValidity(UPLOAD_VALIDITY_MESSAGE);
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

  const errorId = `${kind}-artwork-error`;
  const guidanceId = `${kind}-artwork-guidance`;
  const helpId = `${kind}-artwork-help`;
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
            aspectRatio: kind === 'ip' ? '16 / 9' : '4 / 3',
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
            <span className="mono" style={{ color: 'var(--faint)', fontSize: 11 }}>이미지 없음</span>
          )}
        </div>
        <div className="col admin-artwork-controls" style={{ flex: 1, gap: 8, minWidth: 0 }}>
          <label className="col" style={{ color: 'var(--dim)', fontSize: 13, gap: 7 }}>
            아트워크 파일
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
          <span className="mono" id={helpId} style={{ color: 'var(--faint)', fontSize: 10 }}>
            JPEG, PNG, WebP · 최대 5MB · 가로·세로 최대 8192px · 총 4,000만 픽셀 이하 · 애니메이션 제외
          </span>
          {helpText && <span id={guidanceId} style={{ color: 'var(--dim)', fontSize: 12 }}>{helpText}</span>}
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
          </div>
        </div>
      </div>
      <input name="imagePath" readOnly type="hidden" value={display.imagePath} />
      <div className="mono" style={{ color: 'var(--faint)', fontSize: 10, overflowWrap: 'anywhere' }}>
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
