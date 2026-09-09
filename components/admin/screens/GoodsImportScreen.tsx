'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  prepareGoodsImport,
  previewGoodsImport,
  commitNextGoodsImport,
} from '@/app/admin/goods-import-actions';
import { createClient } from '@/lib/supabase/client';
import {
  GOODS_IMPORT_BUCKET,
  GOODS_IMPORT_PATH,
} from '@/lib/admin/goods-workbook';
import type { goodsImportView } from '@/lib/admin/goods-import.server';
import {
  AdminField,
  AdminPageHeader,
  AdminSectionCard,
  AdminStatusBadge,
} from '../console/AdminKit';
type ImportView = ReturnType<typeof goodsImportView>;
const labels = {
  new: '신규',
  update: '수정',
  unchanged: '변경 없음',
  error: '검증 오류',
};
export function GoodsImportScreen({
  initialView,
  initialError,
}: {
  initialView?: ImportView;
  initialError?: string;
}) {
  const router = useRouter();
  const [view, setView] = useState(initialView);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState(initialError ?? '');
  const workbook = useRef<HTMLInputElement>(null);
  const imageZip = useRef<HTMLInputElement>(null);
  const stop = useRef(false);
  useEffect(
    () => () => {
      stop.current = true;
    },
    [],
  );
  const pending = view?.groups.filter((group) => !group.result).length ?? 0;
  const applicable =
    view?.groups.filter(
      (group) =>
        !group.result && (group.kind === 'new' || group.kind === 'update'),
    ).length ?? 0;
  const unchanged =
    view?.groups.filter((group) => !group.result && group.kind === 'unchanged')
      .length ?? 0;
  const failed =
    view?.groups.filter(
      (group) => group.kind === 'error' || group.result?.status === 'failed',
    ).length ?? 0;
  async function upload() {
    const file = workbook.current?.files?.[0];
    const zip = imageZip.current?.files?.[0];
    if (!file) {
      setError('상품 XLSX 파일을 선택해주세요.');
      return;
    }
    setBusy(true);
    setError('');
    setStatus('파일을 올리고 있습니다.');
    try {
      const prepared = await prepareGoodsImport({
        name: file.name,
        size: file.size,
        imageName: zip?.name,
        imageSize: zip?.size,
      });
      if (!prepared.ok) throw new Error(prepared.error);
      const storage = createClient().storage.from(GOODS_IMPORT_BUCKET);
      const uploaded = await storage.upload(
        `${prepared.prefix}/workbook.xlsx`,
        file,
        {
          contentType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          upsert: false,
        },
      );
      if (uploaded.error)
        throw new Error('XLSX 업로드를 완료하지 못했습니다. 다시 올려주세요.');
      if (zip) {
        const images = await storage.upload(
          `${prepared.prefix}/images.zip`,
          zip,
          { contentType: 'application/zip', upsert: false },
        );
        if (images.error)
          throw new Error(
            '이미지 ZIP 업로드를 완료하지 못했습니다. 다시 올려주세요.',
          );
      }
      setStatus('행별 정보와 현재 상품을 비교하고 있습니다.');
      const preview = await previewGoodsImport(prepared.id);
      if (!preview.ok) throw new Error(preview.error);
      setView(preview.view);
      router.replace(
        `${GOODS_IMPORT_PATH}?batch=${encodeURIComponent(prepared.id)}`,
      );
      setStatus('검증을 완료했습니다. 적용할 내용을 확인해주세요.');
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : '파일 검증을 완료하지 못했습니다.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    if (!view) return;
    stop.current = false;
    setBusy(true);
    setError('');
    try {
      let current = view;
      while (current.groups.some((group) => !group.result) && !stop.current) {
        setStatus(
          `${current.groups.filter((group) => group.result).length} / ${current.groups.length}개 상품 처리 중입니다.`,
        );
        const result = await commitNextGoodsImport(current.id);
        if (!result.ok) throw new Error(result.error);
        current = result.view;
        setView(current);
        if ('retryAfter' in result && result.retryAfter) {
          const until = Date.now() + result.retryAfter;
          while (Date.now() < until && !stop.current) {
            setStatus(
              `이미지 검증 대기 · 약 ${Math.ceil((until - Date.now()) / 1000)}초 후 이어서 처리합니다.`,
            );
            await new Promise((resolve) =>
              setTimeout(resolve, Math.min(1000, until - Date.now())),
            );
          }
        }
      }
      setStatus(
        stop.current
          ? '처리를 잠시 멈췄습니다. 완료된 상품은 저장됐으며 나머지는 이어서 적용할 수 있습니다.'
          : current.groups.every(
                (group) => group.result?.status === 'unchanged',
              )
            ? '변경 없이 완료했습니다.'
            : '처리를 완료했습니다.',
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : '적용을 완료하지 못했습니다. 같은 작업에서 다시 시도해주세요.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="wc-admin-kit">
      <AdminPageHeader
        title="상품 엑셀 등록·수정"
        description="옵션마다 한 행을 작성합니다. 검증 결과를 확인한 뒤 상품별로 적용합니다."
        actions={
          <>
            <a
              className="wc-admin-kit__button"
              href="/api/admin/goods-workbook?mode=template"
            >
              양식 내려받기
            </a>
            <Link className="wc-admin-kit__button" href="/admin/catalog/goods">
              상품 목록
            </Link>
          </>
        }
      />
      <AdminSectionCard title="1. 파일 올리기">
        <p className="wc-admin-kit__description">
          XLSX 2MB · 최대 500행 · 이미지 ZIP 50MB. 상품코드가 같으면 기존 상품을
          수정합니다. 옵션을 모두 포함해주세요.
        </p>
        <AdminField label="상품 XLSX" inputId="goods-workbook">
          <input
            id="goods-workbook"
            type="file"
            accept=".xlsx"
            ref={workbook}
            disabled={busy}
          />
        </AdminField>
        <AdminField
          label="이미지 ZIP (선택)"
          inputId="goods-images"
          hint="파일명 열을 쓴 경우 JPEG·PNG·WebP 이미지를 함께 올려주세요."
        >
          <input
            id="goods-images"
            type="file"
            accept=".zip"
            ref={imageZip}
            disabled={busy}
            aria-describedby="goods-images-hint"
          />
        </AdminField>
        <button
          className="wc-admin-kit__button"
          type="button"
          onClick={upload}
          disabled={busy}
        >
          파일 검증
        </button>
      </AdminSectionCard>
      {error ? (
        <p role="alert" className="wc-admin-kit__error">
          {error}
        </p>
      ) : null}
      <p role="status" aria-live="polite" className="wc-admin-kit__hint">
        {status}
      </p>
      {view ? (
        <AdminSectionCard title="2. 검증 결과 확인·적용">
          <p>
            {view.fileName} · {view.groups.length}개 상품 ·{' '}
            {view.groups.reduce((count, group) => count + group.rows.length, 0)}
            행
          </p>
          <p className="wc-admin-kit__description">
            같은 상품의 옵션은 함께 성공하거나 실패합니다. 변경 없는 상품은
            저장하지 않습니다. 새 이미지는 적용할 때 검증하며, 주소·파일 오류가
            있으면 해당 상품만 실패합니다.
          </p>
          <div className="wc-admin-kit__actions">
            {pending ? (
              <button
                type="button"
                className="wc-admin-kit__button"
                onClick={apply}
                disabled={busy}
              >
                {applicable
                  ? `검증한 ${applicable}개 상품 적용`
                  : unchanged
                    ? '변경 없이 완료'
                    : '검증 오류 결과 확정'}
              </button>
            ) : null}
            {busy ? (
              <button
                type="button"
                className="wc-admin-kit__button"
                onClick={() => {
                  stop.current = true;
                }}
              >
                현재 상품 처리 후 멈춤
              </button>
            ) : null}
            {failed ? (
              <a
                className="wc-admin-kit__button"
                href={`/api/admin/goods-workbook?mode=failures&batch=${encodeURIComponent(view.id)}`}
              >
                실패 행 내려받기
              </a>
            ) : null}
          </div>
          <p className="wc-admin-kit__hint">
            이 작업은 24시간 동안 이어서 열 수 있습니다. 실패 행을 다시 올릴 때
            파일명을 사용했다면 원래 이미지 ZIP도 함께 올려주세요.
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table className="admin-console-grid-table">
              <caption className="sr-only">상품 엑셀 행별 검증 결과</caption>
              <thead>
                <tr>
                  <th scope="col">행</th>
                  <th scope="col">상품</th>
                  <th scope="col">분류</th>
                  <th scope="col">검증·적용 결과</th>
                </tr>
              </thead>
              <tbody>
                {view.groups.map((group) => (
                  <tr key={group.index}>
                    <td>{group.rows.join(', ')}</td>
                    <td>
                      {group.name || '이름 없음'}
                      <small style={{ display: 'block' }}>
                        {group.code || '코드 자동 생성'}
                      </small>
                    </td>
                    <td>
                      <AdminStatusBadge
                        tone={
                          group.kind === 'error'
                            ? 'danger'
                            : group.kind === 'new'
                              ? 'success'
                              : 'neutral'
                        }
                      >
                        {labels[group.kind]}
                      </AdminStatusBadge>
                    </td>
                    <td>
                      {group.errors.map((message) => (
                        <p key={message} className="wc-admin-kit__error">
                          {message}
                        </p>
                      ))}
                      {group.warnings.map((message) => (
                        <p key={message}>
                          <AdminStatusBadge tone="warning">
                            {message}
                          </AdminStatusBadge>
                        </p>
                      ))}
                      {group.result ? (
                        <p>
                          {group.result.status === 'success'
                            ? '저장 완료'
                            : group.result.status === 'unchanged'
                              ? '변경 없이 완료'
                              : group.result.error}
                        </p>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </AdminSectionCard>
      ) : null}
    </section>
  );
}
