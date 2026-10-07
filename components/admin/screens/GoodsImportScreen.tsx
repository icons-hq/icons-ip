'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  prepareGoodsImport,
  previewGoodsImport,
  commitNextGoodsImport,
  inspectSabangnetGoodsImport,
  previewSabangnetGoodsImport,
  type SabangnetGoodsInspection,
} from '@/app/admin/goods-import-actions';
import { createClient } from '@/lib/supabase/client';
import {
  GOODS_IMPORT_BUCKET,
  GOODS_IMPORT_PATH,
} from '@/lib/admin/goods-workbook';
import type { goodsImportView } from '@/lib/admin/goods-import.server';
import {
  parseRememberedSabangnetTargets,
  rememberSabangnetTargets,
  SABANGNET_GALLERY_LIMIT,
  SABANGNET_IMAGE_LIMIT,
  SABANGNET_TARGETS,
  suggestSabangnetBrandIps,
  suggestSabangnetTargets,
  validateSabangnetTargets,
  type SabangnetColumnStatus,
  type SabangnetTarget,
} from '@/lib/admin/sabangnet-goods-format';
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
type ImportFormat = 'icons' | 'sabangnet';
type ColumnState = SabangnetColumnStatus | 'manual';
const COLUMN_STATES: Record<ColumnState, { label: string; tone: 'neutral' | 'success' | 'warning' }> = {
  confirmed: { label: '자동 인식', tone: 'success' },
  guessed: { label: '추정 · 확인 필요', tone: 'warning' },
  remembered: { label: '지난번 선택', tone: 'neutral' },
  known: { label: '사방넷 열 · 기본 제외', tone: 'neutral' },
  unknown: { label: '인식 못 함 · 직접 선택', tone: 'warning' },
  duplicate: { label: '앞 열과 같은 항목', tone: 'warning' },
  manual: { label: '직접 고름', tone: 'neutral' },
};
const SABANGNET_COLUMNS_KEY = 'icons-admin:sabangnet-columns:v1';
function readRememberedColumns() {
  try {
    return parseRememberedSabangnetTargets(window.localStorage.getItem(SABANGNET_COLUMNS_KEY));
  } catch {
    return {};
  }
}
function rememberColumns(headers: string[], targets: SabangnetTarget[]) {
  try {
    window.localStorage.setItem(
      SABANGNET_COLUMNS_KEY,
      JSON.stringify({ ...readRememberedColumns(), ...rememberSabangnetTargets(headers, targets) }),
    );
  } catch {
    // The mapping memory is a convenience; a blocked store only loses the default.
  }
}
/** Column → ICONS item mapping, IP choice and per-brand IP suggestions for a Sabangnet file. */
export function SabangnetMappingStep({
  inspection,
  targets,
  columnStates,
  ipId,
  brandIps,
  busy,
  onTarget,
  onIp,
  onBrandIp,
  onPreview,
}: {
  inspection: SabangnetGoodsInspection;
  targets: SabangnetTarget[];
  columnStates: ColumnState[];
  ipId: string;
  brandIps: Record<string, string>;
  busy: boolean;
  onTarget: (column: number, target: SabangnetTarget) => void;
  onIp: (ipId: string) => void;
  onBrandIp: (brand: string, ipId: string) => void;
  onPreview: () => void;
}) {
  const brandColumn = targets.indexOf('brand');
  const brands = brandColumn >= 0 ? inspection.columns[brandColumn]?.values ?? [] : [];
  const unknown = columnStates.filter((state) => state === 'unknown' || state === 'guessed').length;
  return (
    <AdminSectionCard title="2. 열 연결·IP 선택">
      <p className="wc-admin-kit__description">
        {inspection.fileName} · {inspection.headerRow}행을 열 이름으로 읽었습니다 · 상품 {inspection.rowCount}행.
        {unknown ? ` 확인이 필요한 열 ${unknown}개가 있습니다.` : ''} 연결하지 않은 열은 가져오지 않습니다.
      </p>
      <AdminField
        label="연결 IP (필수)"
        inputId="sabangnet-ip"
        hint="사방넷 양식에는 IP가 없습니다. 새 상품을 모두 이 IP에 연결합니다."
      >
        <select
          id="sabangnet-ip"
          value={ipId}
          onChange={(event) => onIp(event.target.value)}
          disabled={busy}
          aria-describedby="sabangnet-ip-hint"
          required
        >
          <option value="">IP를 골라 주세요</option>
          {inspection.ips.map((ip) => (
            <option key={ip.id} value={ip.id}>
              {ip.title}
            </option>
          ))}
        </select>
      </AdminField>
      <div style={{ overflowX: 'auto' }}>
        <table className="admin-console-grid-table">
          <caption className="sr-only">사방넷 열과 ICONS 항목 연결</caption>
          <thead>
            <tr>
              <th scope="col">사방넷 열</th>
              <th scope="col">예시 값</th>
              <th scope="col">ICONS 항목</th>
              <th scope="col">인식</th>
            </tr>
          </thead>
          <tbody>
            {inspection.columns.map((column, index) => (
              <tr key={`${index}-${column.header}`}>
                <td>{column.header || `${index + 1}번째 열(이름 없음)`}</td>
                <td>{column.sample || '—'}</td>
                <td>
                  <div className="wc-admin-kit__field">
                    <select
                      aria-label={`${column.header || `${index + 1}번째 열`} 열을 연결할 ICONS 항목`}
                      value={targets[index]}
                      onChange={(event) => onTarget(index, event.target.value as SabangnetTarget)}
                      disabled={busy}
                    >
                      {SABANGNET_TARGETS.map((target) => (
                        <option key={target.key} value={target.key}>
                          {target.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </td>
                <td>
                  <AdminStatusBadge tone={COLUMN_STATES[columnStates[index]].tone}>
                    {COLUMN_STATES[columnStates[index]].label}
                  </AdminStatusBadge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {brands.length ? (
        <div style={{ overflowX: 'auto' }}>
          <table className="admin-console-grid-table">
            <caption>브랜드별 IP · 브랜드명이 IP 이름과 같으면 그 IP를 미리 골라 두었습니다.</caption>
            <thead>
              <tr>
                <th scope="col">브랜드명</th>
                <th scope="col">연결 IP</th>
              </tr>
            </thead>
            <tbody>
              {brands.map((brand) => (
                <tr key={brand}>
                  <td>{brand}</td>
                  <td>
                    <div className="wc-admin-kit__field">
                      <select
                        aria-label={`${brand} 브랜드 상품을 연결할 IP`}
                        value={brandIps[brand] ?? ''}
                        onChange={(event) => onBrandIp(brand, event.target.value)}
                        disabled={busy}
                      >
                        <option value="">위에서 고른 연결 IP</option>
                        {inspection.ips.map((ip) => (
                          <option key={ip.id} value={ip.id}>
                            {ip.title}
                          </option>
                        ))}
                      </select>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="wc-admin-kit__hint">
        옵션제목·옵션상세명칭은 옵션 축과 값(쉼표 구분)으로, 대표이미지·부가이미지는 대표 이미지와 추가 이미지
        {SABANGNET_GALLERY_LIMIT}장으로 가져옵니다. 옵션 재고는 0으로 만들고, 인증 정보는 KC 검토에 반영하지 않습니다.
      </p>
      <button className="wc-admin-kit__button" type="button" onClick={onPreview} disabled={busy}>
        미리보기 만들기
      </button>
    </AdminSectionCard>
  );
}
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
  const sabangnetFile = useRef<HTMLInputElement>(null);
  const stop = useRef(false);
  const [format, setFormat] = useState<ImportFormat>(initialView?.format ?? 'icons');
  const [inspection, setInspection] = useState<SabangnetGoodsInspection | null>(null);
  const [targets, setTargets] = useState<SabangnetTarget[]>([]);
  const [columnStates, setColumnStates] = useState<ColumnState[]>([]);
  const [ipId, setIpId] = useState('');
  const [brandIps, setBrandIps] = useState<Record<string, string>>({});
  const [ignoredColumns, setIgnoredColumns] = useState<string[] | null>(null);
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
  // Only rows the failure workbook contains; existing Sabangnet codes are left out of it.
  const failed =
    view?.groups.filter(
      (group) =>
        group.retryable &&
        (group.kind === 'error' || group.result?.status === 'failed'),
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
      setStatus('');
      setError(
        error instanceof Error
          ? error.message
          : '파일 검증을 완료하지 못했습니다.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function inspectSabangnet() {
    const file = sabangnetFile.current?.files?.[0];
    if (!file) {
      setError('사방넷에서 내려받은 상품 파일을 선택해 주세요.');
      return;
    }
    if (/\.xls$/i.test(file.name)) {
      setError('XLS(Excel 97-2003) 파일은 읽을 수 없습니다. 엑셀에서 “Excel 통합 문서(.xlsx)”로 저장해 다시 올려 주세요.');
      return;
    }
    setBusy(true);
    setError('');
    setView(undefined);
    setInspection(null);
    setIgnoredColumns(null);
    setStatus('파일을 올리고 있습니다.');
    try {
      const prepared = await prepareGoodsImport({ name: file.name, size: file.size, format: 'sabangnet' });
      if (!prepared.ok) throw new Error(prepared.error);
      // The private object keeps its fixed name; the server reads the bytes to tell XLSX from CSV.
      const uploaded = await createClient()
        .storage.from(GOODS_IMPORT_BUCKET)
        .upload(`${prepared.prefix}/workbook.xlsx`, file, {
          contentType: /\.csv$/i.test(file.name)
            ? 'application/octet-stream'
            : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          upsert: false,
        });
      if (uploaded.error) throw new Error('파일 업로드를 완료하지 못했습니다. 다시 올려 주세요.');
      setStatus('열 이름을 읽고 있습니다.');
      const inspected = await inspectSabangnetGoodsImport(prepared.id);
      if (!inspected.ok) throw new Error(inspected.error);
      const headers = inspected.inspection.columns.map((column) => column.header);
      const suggestion = suggestSabangnetTargets(headers, readRememberedColumns());
      setInspection(inspected.inspection);
      setTargets(suggestion.targets);
      setColumnStates(suggestion.status);
      setIpId(inspected.inspection.ips.length === 1 ? inspected.inspection.ips[0].id : '');
      const brandColumn = suggestion.targets.indexOf('brand');
      setBrandIps(
        suggestSabangnetBrandIps(
          brandColumn >= 0 ? inspected.inspection.columns[brandColumn].values ?? [] : [],
          inspected.inspection.ips,
        ),
      );
      setStatus('열 연결을 확인하고 연결 IP를 고른 뒤 미리보기를 만들어 주세요.');
    } catch (error) {
      setStatus('');
      setError(error instanceof Error ? error.message : '파일을 읽지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }
  function changeTarget(column: number, target: SabangnetTarget) {
    setTargets((current) => current.map((value, index) => (index === column ? target : value)));
    setColumnStates((current) => current.map((value, index) => (index === column ? 'manual' : value)));
    if (target === 'brand' && inspection)
      setBrandIps(suggestSabangnetBrandIps(inspection.columns[column].values ?? [], inspection.ips));
  }
  async function previewSabangnet() {
    if (!inspection) return;
    const headers = inspection.columns.map((column) => column.header);
    const invalid = validateSabangnetTargets(targets, headers);
    if (invalid || !ipId) {
      setError(invalid ?? '새 상품을 연결할 IP를 골라 주세요.');
      return;
    }
    setBusy(true);
    setError('');
    setStatus('행을 ICONS 상품으로 바꾸고 이미지 주소를 확인하고 있습니다. 이미지가 많으면 몇 분 걸릴 수 있습니다.');
    try {
      const brandColumn = targets.indexOf('brand');
      const brands = new Set(brandColumn >= 0 ? inspection.columns[brandColumn].values ?? [] : []);
      const result = await previewSabangnetGoodsImport(inspection.id, {
        targets,
        ipId,
        brandIps: Object.fromEntries(Object.entries(brandIps).filter(([brand, ip]) => ip && brands.has(brand))),
      });
      if (!result.ok) throw new Error(result.error);
      rememberColumns(headers, targets);
      setView(result.view);
      setIgnoredColumns(result.ignoredColumns);
      setInspection(null);
      router.replace(`${GOODS_IMPORT_PATH}?batch=${encodeURIComponent(inspection.id)}`);
      setStatus('미리보기를 만들었습니다. 오류·경고를 확인하고 초안을 만들어 주세요.');
    } catch (error) {
      setStatus('');
      setError(error instanceof Error ? error.message : '미리보기를 만들지 못했습니다.');
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
      setStatus('');
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
    <section className="wc-admin-kit wc-admin-kit__screen">
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
        <AdminField
          label="양식"
          inputId="goods-import-format"
          hint={
            format === 'sabangnet'
              ? '사방넷에서 내려받은 상품 엑셀을 그대로 올립니다. 모든 상품은 초안으로 만듭니다.'
              : 'ICONS 양식을 내려받아 작성한 파일을 올립니다.'
          }
        >
          <select
            id="goods-import-format"
            value={format}
            onChange={(event) => {
              setFormat(event.target.value as ImportFormat);
              setInspection(null);
              setError('');
            }}
            disabled={busy}
            aria-describedby="goods-import-format-hint"
          >
            <option value="icons">ICONS 자체 양식</option>
            <option value="sabangnet">사방넷 상품 양식</option>
          </select>
        </AdminField>
        {format === 'sabangnet' ? (
          <>
            <p className="wc-admin-kit__description">
              .xlsx 또는 .csv · 2MB · 상품 최대 500개(옵션 조합을 펼쳐 500행까지). 위쪽 안내 행은 건너뛰고 열
              이름 행을 찾습니다. .xls 파일은 엑셀에서 .xlsx로 저장해 올려 주세요. 이미지 주소는 서버가 내려받아
              확인하며, 한 번에 최대 {SABANGNET_IMAGE_LIMIT}장까지 가져옵니다. 이미 등록된 상품코드는 수정하지 않고 오류로 표시합니다.
            </p>
            <AdminField label="사방넷 상품 파일" inputId="sabangnet-workbook">
              <input
                id="sabangnet-workbook"
                type="file"
                accept=".xlsx,.csv,.xls"
                ref={sabangnetFile}
                disabled={busy}
              />
            </AdminField>
            <button
              className="wc-admin-kit__button"
              type="button"
              onClick={inspectSabangnet}
              disabled={busy}
            >
              열 확인
            </button>
          </>
        ) : (
          <>
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
          </>
        )}
      </AdminSectionCard>
      {format === 'sabangnet' && inspection ? (
        <SabangnetMappingStep
          inspection={inspection}
          targets={targets}
          columnStates={columnStates}
          ipId={ipId}
          brandIps={brandIps}
          busy={busy}
          onTarget={changeTarget}
          onIp={setIpId}
          onBrandIp={(brand, ip) => setBrandIps((current) => ({ ...current, [brand]: ip }))}
          onPreview={previewSabangnet}
        />
      ) : null}
      {error ? (
        <p role="alert" className="wc-admin-kit__error">
          {error}
        </p>
      ) : null}
      <p role="status" aria-live="polite" className="wc-admin-kit__hint">
        {status}
      </p>
      {view ? (
        <AdminSectionCard
          title={
            view.format === 'sabangnet'
              ? '3. 검증 결과 확인·초안 만들기'
              : '2. 검증 결과 확인·적용'
          }
        >
          <p>
            {view.fileName} · {view.groups.length}개 상품 ·{' '}
            {view.groups.reduce((count, group) => count + group.rows.length, 0)}
            행
          </p>
          {view.format === 'sabangnet' ? (
            <p className="wc-admin-kit__description">
              모든 상품을 초안으로 만들고 공개하지 않습니다. 받지 못한 이미지는 경고로 표시하고 이미지 없이
              만듭니다. 대표 이미지·고시정보·출고지·KC 검토를 상품 편집에서 채운 뒤 공개해 주세요.
            </p>
          ) : (
            <p className="wc-admin-kit__description">
              같은 상품의 옵션은 함께 성공하거나 실패합니다. 변경 없는 상품은
              저장하지 않습니다. 새 이미지는 적용할 때 검증하며, 주소·파일 오류가
              있으면 해당 상품만 실패합니다.
            </p>
          )}
          {view.format === 'sabangnet' && ignoredColumns?.length ? (
            <p className="wc-admin-kit__hint">
              가져오지 않은 열 {ignoredColumns.length}개: {ignoredColumns.join(', ')}
            </p>
          ) : null}
          <div className="wc-admin-kit__actions">
            {pending ? (
              <button
                type="button"
                className="wc-admin-kit__button"
                onClick={apply}
                disabled={busy}
              >
                {applicable
                  ? view.format === 'sabangnet'
                    ? `검증한 ${applicable}개 상품 초안 만들기`
                    : `검증한 ${applicable}개 상품 적용`
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
          {view.format === 'sabangnet' ? (
            <p className="wc-admin-kit__hint">
              이 작업은 24시간 동안 이어서 열 수 있습니다. 실패 행은 ICONS 양식으로 내려받으며, 이미 등록된
              상품코드 행은 넣지 않습니다. 고친 뒤 ICONS 자체 양식으로 올려 주세요.
            </p>
          ) : (
            <p className="wc-admin-kit__hint">
              이 작업은 24시간 동안 이어서 열 수 있습니다. 실패 행을 다시 올릴 때
              파일명을 사용했다면 원래 이미지 ZIP도 함께 올려주세요.
            </p>
          )}
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
                            ? view.format === 'sabangnet'
                              ? '초안 저장 완료'
                              : '저장 완료'
                            : group.result.status === 'unchanged'
                              ? '변경 없이 완료'
                              : group.result.error}
                        </p>
                      ) : null}
                      {group.result?.status === 'success' && group.skippedImages ? (
                        <p>
                          <AdminStatusBadge tone="warning">
                            {`이미지 ${group.skippedImages}장은 확인하지 못해 빼고 저장했습니다. 상품 편집에서 올려 주세요.`}
                          </AdminStatusBadge>
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
