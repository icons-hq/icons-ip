'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CategoryCodeFinder } from '../CategoryCodeFinder';
import { CountryNamePicker } from '../CountryNameFinder';
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
  GOODS_IMAGES_ZIP_BYTES_LIMIT,
  GOODS_IMPORT_BUCKET,
  GOODS_IMPORT_PATH,
  GOODS_WORKBOOK_BYTES_LIMIT,
  GOODS_WORKBOOK_ROW_LIMIT,
} from '@/lib/admin/goods-workbook';
import type { goodsImportView } from '@/lib/admin/goods-import.server';
import {
  parseRememberedSabangnetTargets,
  rememberSabangnetTargets,
  sabangnetPriceReadback,
  SABANGNET_GALLERY_LIMIT,
  SABANGNET_IMAGE_LIMIT,
  SABANGNET_PRICE_REQUIRED,
  SABANGNET_TARGETS,
  suggestSabangnetBrandIps,
  suggestSabangnetTargets,
  validateSabangnetTargets,
  type SabangnetColumnStatus,
  type SabangnetTarget,
} from '@/lib/admin/sabangnet-goods-format';
import { Download, TriangleAlert } from 'lucide-react';
import { GoodsFlowSteps } from './GoodsFlowSteps';
import { statusTone } from '@/lib/admin/status-tone';
import { adminConfirm } from '@/lib/admin/confirm';
import {
  goodsImportPriceChangeText,
  goodsImportPriceConfirmation,
  goodsImportPriceGuardLines,
  goodsPriceGuardReasonText,
} from '@/lib/admin/goods-price-guard';
import {
  AdminField,
  AdminFormGrid,
  AdminNotice,
  AdminPageHeader,
  AdminSectionCard,
  AdminStatusBadge,
} from '../console/AdminKit';
import { AdminSelect } from '../console/AdminSelect';
import { Button, buttonVariants } from '../kit/ui/button';
import { Input } from '../kit/ui/input';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '../kit/ui/table';
type ImportView = ReturnType<typeof goodsImportView>;
/* 검증 경고는 긴 문장이라 배지 대신 경고색 줄로 보인다(배지는 한 줄로 잘린다). */
const WARNING = 'flex items-start gap-1.5 text-sm text-warning';
const labels = {
  new: '신규',
  update: '수정',
  unchanged: '변경 없음',
  error: '검증 오류',
};
type ImportFormat = 'icons' | 'sabangnet';
type ColumnState = SabangnetColumnStatus | 'manual';
const COLUMN_LABELS: Record<ColumnState, string> = {
  confirmed: '자동 인식',
  guessed: '추정 · 확인 필요',
  remembered: '지난번 선택',
  known: '사방넷 열 · 기본 제외',
  unknown: '인식 못 함 · 직접 선택',
  duplicate: '앞 열과 같은 항목',
  manual: '직접 고름',
};
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/* 파일 칸 아래 한 줄에 쓰는 올리기 한도. 서버가 받는 한도와 같은 값을 쓴다. */
const megabytes = (bytes: number) => `${Math.round(bytes / (1024 * 1024))}MB`;
const SABANGNET_FILE_HINT = `.xlsx 또는 .csv · ${megabytes(GOODS_WORKBOOK_BYTES_LIMIT)}까지 · 옵션을 한 줄씩 펼쳐 ${GOODS_WORKBOOK_ROW_LIMIT}줄까지 · 이미지는 한 번에 ${SABANGNET_IMAGE_LIMIT}장까지`;
const ICONS_FILE_HINT = `${megabytes(GOODS_WORKBOOK_BYTES_LIMIT)}·${GOODS_WORKBOOK_ROW_LIMIT}줄까지입니다. 예전에 내려받은 양식도 올릴 수 있습니다.`;
const ICONS_ZIP_HINT = `이미지 파일명 열을 썼다면 그 이미지(JPEG·PNG·WebP)를 ZIP으로 함께 올려주세요. ${megabytes(GOODS_IMAGES_ZIP_BYTES_LIMIT)}까지입니다.`;
/* 몇 단계 중 어디인지 보이는 순서 표시. 단계 이름은 아래 카드 제목과 같은 말이다. */
const IMPORT_STEPS: Record<ImportFormat, string[]> = {
  icons: ['파일 올리기', '검증 결과 확인·적용'],
  sabangnet: ['파일 올리기', '열 연결·IP 선택', '검증 결과 확인·초안 만들기'],
};
/**
 * storage-js sends a File/Blob as a multipart part typed by the Blob itself and ignores the
 * contentType option, and Storage checks that part type against the private bucket's allow-list
 * (XLSX·ZIP·octet-stream). Browsers type .csv as text/csv or application/vnd.ms-excel and Windows
 * Chrome types .zip as application/x-zip-compressed, so every upload is re-typed to an allowed type.
 */
function typedUpload(file: Blob, type: string) {
  return file.slice(0, file.size, type);
}
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
  /* 숫자 앞뒤에 JSX 줄바꿈이 끼지 않게 한 문장으로 만든다. */
  const summary = `${inspection.fileName} · 엑셀 ${inspection.headerRow}번째 줄을 열 이름으로 읽었습니다 · 상품 ${inspection.rowCount}줄${unknown ? ` · 확인이 필요한 열 ${unknown}개` : ''}`;
  /* 돈이 걸린 연결은 결과를 되읽는다 — 지금 연결로 판매가·즉시할인이 어떻게 들어가는지, 금액 열이 빠졌으면 무엇을 골라야 하는지. */
  const priceReadback = sabangnetPriceReadback(inspection.columns.map((column) => column.header), targets);
  return (
    <AdminSectionCard title="2. 열 연결·IP 선택">
      <p className="text-sm text-muted-foreground">{summary}</p>
      <AdminField
        label="연결 IP (필수)"
        inputId="sabangnet-ip"
        hint="사방넷 파일에는 IP가 없어서 새 상품을 모두 이 IP에 연결합니다."
      >
        <AdminSelect
          id="sabangnet-ip"
          value={ipId}
          onChange={(event) => onIp(event.target.value)}
          disabled={busy}
          aria-describedby="sabangnet-ip-hint"
          required
          wrapperClassName="w-full sm:max-w-sm"
        >
          <option value="">IP를 골라 주세요</option>
          {inspection.ips.map((ip) => (
            <option key={ip.id} value={ip.id}>
              {ip.title}
            </option>
          ))}
        </AdminSelect>
      </AdminField>
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableCaption className="sr-only">사방넷 열과 엑스스퀘어 항목 연결</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">사방넷 열</TableHead>
              <TableHead scope="col">예시 값</TableHead>
              <TableHead scope="col">엑스스퀘어 항목</TableHead>
              <TableHead scope="col">인식</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {inspection.columns.map((column, index) => (
              <TableRow key={`${index}-${column.header}`}>
                <TableCell className="whitespace-normal">{column.header || `${index + 1}번째 열(이름 없음)`}</TableCell>
                <TableCell className="max-w-56 truncate text-muted-foreground">{column.sample || '—'}</TableCell>
                <TableCell>
                  <AdminSelect
                    aria-label={`${column.header || `${index + 1}번째 열`} 열을 연결할 엑스스퀘어 항목`}
                    value={targets[index]}
                    onChange={(event) => onTarget(index, event.target.value as SabangnetTarget)}
                    disabled={busy}
                    wrapperClassName="w-56"
                  >
                    {SABANGNET_TARGETS.map((target) => (
                      <option key={target.key} value={target.key}>
                        {target.label}
                      </option>
                    ))}
                  </AdminSelect>
                </TableCell>
                <TableCell>
                  <AdminStatusBadge tone={statusTone('sabangnetColumn', columnStates[index])}>
                    {COLUMN_LABELS[columnStates[index]]}
                  </AdminStatusBadge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {priceReadback ? (
        <p className="rounded-lg bg-muted/40 px-3 py-2 text-sm text-foreground" data-sabangnet-price="readback" role="status">
          {priceReadback}
        </p>
      ) : (
        <p className={WARNING} data-sabangnet-price="missing" role="status">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          {SABANGNET_PRICE_REQUIRED}
        </p>
      )}
      {brands.length ? (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableCaption className="mt-0 caption-top px-2 py-2 text-left">브랜드별 IP · 브랜드명과 이름이 같은 IP는 미리 골라 두었습니다.</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">브랜드명</TableHead>
                <TableHead scope="col">연결 IP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {brands.map((brand) => (
                <TableRow key={brand}>
                  <TableCell className="whitespace-normal">{brand}</TableCell>
                  <TableCell>
                    <AdminSelect
                      aria-label={`${brand} 브랜드 상품을 연결할 IP`}
                      value={brandIps[brand] ?? ''}
                      onChange={(event) => onBrandIp(brand, event.target.value)}
                      disabled={busy}
                      wrapperClassName="w-56"
                    >
                      <option value="">위에서 고른 연결 IP</option>
                      {inspection.ips.map((ip) => (
                        <option key={ip.id} value={ip.id}>
                          {ip.title}
                        </option>
                      ))}
                    </AdminSelect>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
      <p className="text-sm text-muted-foreground">
        {`대표이미지·부가이미지는 대표 이미지와 추가 이미지 ${SABANGNET_GALLERY_LIMIT}장까지 가져오고, 옵션 재고수량은 0으로 만듭니다.`}
      </p>
      <Button className="self-start" type="button" onClick={onPreview} disabled={busy}>
        미리보기 만들기
      </Button>
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
  const [categoryFinder, setCategoryFinder] = useState(false);
  const [countryFinder, setCountryFinder] = useState(false);
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
  /** 엑셀에서 읽은 줄 수(옵션마다 한 줄이라 상품 수보다 많을 수 있다). */
  const lines = view?.groups.reduce((count, group) => count + group.rows.length, 0) ?? 0;
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
        typedUpload(file, XLSX_TYPE),
        { contentType: XLSX_TYPE, upsert: false },
      );
      if (uploaded.error)
        throw new Error('XLSX 업로드를 완료하지 못했습니다. 다시 올려주세요.');
      if (zip) {
        const images = await storage.upload(
          `${prepared.prefix}/images.zip`,
          typedUpload(zip, 'application/zip'),
          { contentType: 'application/zip', upsert: false },
        );
        if (images.error)
          throw new Error(
            '이미지 ZIP 업로드를 완료하지 못했습니다. 다시 올려주세요.',
          );
      }
      setStatus('줄별 정보와 현재 상품을 비교하고 있습니다.');
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
          : '파일을 올려 확인하지 못했습니다. 다시 시도해주세요.',
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
      const type = /\.csv$/i.test(file.name) ? 'application/octet-stream' : XLSX_TYPE;
      const uploaded = await createClient()
        .storage.from(GOODS_IMPORT_BUCKET)
        .upload(`${prepared.prefix}/workbook.xlsx`, typedUpload(file, type), {
          contentType: type,
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
    setStatus('엑셀 줄을 엑스스퀘어 상품으로 바꾸고 이미지 주소를 확인하고 있습니다. 이미지가 많으면 몇 분 걸릴 수 있습니다.');
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
    // 적용 순간 한 번: 이 파일로 적용할 상품 중 판매가가 0원·1,000원 미만이거나 절반 이하·두 배 이상인 것을 모아 확인받는다.
    const priceCheck = goodsImportPriceConfirmation(
      view.groups.filter((group) => !group.result && (group.kind === 'new' || group.kind === 'update')),
    );
    if (priceCheck && !(await adminConfirm(priceCheck))) return;
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
    <section className="flex min-w-0 flex-col gap-4" data-admin-screen="goods-import">
      <AdminPageHeader
        title="상품 일괄등록"
        description="엑셀 파일을 올려 상품을 한꺼번에 등록·수정합니다."
        actions={
          <>
            <Button variant="outline" type="button" onClick={() => setCategoryFinder(true)}>카테고리 코드 고르기</Button>
            <Button variant="outline" type="button" onClick={() => setCountryFinder(true)}>원산지 고르기</Button>
            <Link className={buttonVariants({ variant: 'outline' })} data-slot="button" href="/admin/catalog/goods">
              상품 목록
            </Link>
          </>
        }
      />
      {categoryFinder ? <CategoryCodeFinder onClose={() => setCategoryFinder(false)} /> : null}
      {countryFinder ? <CountryNamePicker mode="copy" onClose={() => setCountryFinder(false)} /> : null}
      <GoodsFlowSteps steps={IMPORT_STEPS[view?.format ?? format]} current={view ? IMPORT_STEPS[view.format].length - 1 : inspection ? 1 : 0} />
      <AdminSectionCard title="1. 파일 올리기">
        {/* 양식 내려받기가 올리기보다 먼저다 — 고른 양식 바로 옆에 둔다. */}
        <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
          <div className="min-w-0 flex-1 basis-72 sm:max-w-sm">
            <AdminField
              label="양식"
              inputId="goods-import-format"
              hint={
                format === 'sabangnet'
                  ? '사방넷에서 내려받은 상품 엑셀을 그대로 올립니다. 모든 상품은 초안으로 만듭니다.'
                  : '엑스스퀘어 양식을 내려받아 옵션마다 한 줄씩 작성한 파일을 올립니다.'
              }
            >
              <AdminSelect
                id="goods-import-format"
                value={format}
                onChange={(event) => {
                  setFormat(event.target.value as ImportFormat);
                  setInspection(null);
                  setError('');
                }}
                disabled={busy}
                aria-describedby="goods-import-format-hint"
                wrapperClassName="w-full"
              >
                <option value="icons">엑스스퀘어 자체 양식</option>
                <option value="sabangnet">사방넷 상품 양식</option>
              </AdminSelect>
            </AdminField>
          </div>
          {format === 'sabangnet' ? null : (
            <a
              className={`${buttonVariants({ variant: 'soft' })} sm:mt-7`}
              data-slot="button"
              href="/api/admin/goods-workbook?mode=template"
            >
              <Download aria-hidden="true" />
              양식 내려받기
            </a>
          )}
        </div>
        {format === 'sabangnet' ? (
          <>
            <AdminField label="사방넷 상품 파일" inputId="sabangnet-workbook" hint={SABANGNET_FILE_HINT}>
              <Input
                className="sm:max-w-md"
                id="sabangnet-workbook"
                type="file"
                accept=".xlsx,.csv,.xls"
                ref={sabangnetFile}
                disabled={busy}
                aria-describedby="sabangnet-workbook-hint"
              />
            </AdminField>
            <Button
              className="self-start"
              type="button"
              onClick={inspectSabangnet}
              disabled={busy}
            >
              열 읽어 오기
            </Button>
          </>
        ) : (
          <>
            <AdminNotice tone="warning" title="상품번호나 상품 자동코드가 같으면 기존 상품을 수정합니다." />
            <AdminFormGrid>
              <AdminField label="상품 XLSX" inputId="goods-workbook" hint={ICONS_FILE_HINT}>
                <Input
                  id="goods-workbook"
                  type="file"
                  accept=".xlsx"
                  ref={workbook}
                  disabled={busy}
                  aria-describedby="goods-workbook-hint"
                />
              </AdminField>
              <AdminField
                label="이미지 ZIP (선택)"
                inputId="goods-images"
                hint={ICONS_ZIP_HINT}
              >
                <Input
                  id="goods-images"
                  type="file"
                  accept=".zip"
                  ref={imageZip}
                  disabled={busy}
                  aria-describedby="goods-images-hint"
                />
              </AdminField>
            </AdminFormGrid>
            <Button
              className="self-start"
              type="button"
              onClick={upload}
              disabled={busy}
            >
              파일 올리고 확인하기
            </Button>
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
      {error ? <AdminNotice role="alert" tone="danger">{error}</AdminNotice> : null}
      {/* 빈 상태 알림도 접근성 트리에 남긴다(sr-only) — 내용이 생기면 읽히고 보인다. */}
      <p role="status" aria-live="polite" className="text-sm text-muted-foreground empty:sr-only">
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
          <p className="text-sm tabular-nums">{`${view.fileName} · ${view.groups.length}개 상품 · 엑셀 ${lines}줄`}</p>
          {/* 긴 표를 내리기 전에 오류 건수를 먼저 보이게 한다. */}
          <p className="flex flex-wrap gap-1.5">
            {(['error', 'new', 'update', 'unchanged'] as const).map((kind) => {
              const count = view.groups.filter((group) => group.kind === kind).length;
              return count ? <AdminStatusBadge key={kind} tone={statusTone('goodsImport', kind)}>{labels[kind]} {count}</AdminStatusBadge> : null;
            })}
          </p>
          {view.format === 'sabangnet' && ignoredColumns?.length ? (
            <p className="text-sm text-muted-foreground">
              가져오지 않은 열 {ignoredColumns.length}개: {ignoredColumns.join(', ')}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {pending ? (
              <Button
                type="button"
                onClick={apply}
                disabled={busy}
              >
                {applicable
                  ? view.format === 'sabangnet'
                    ? `검증한 ${applicable}개 상품 초안 만들기`
                    : `검증한 ${applicable}개 상품 적용`
                  : unchanged
                    ? '변경 없이 완료'
                    : '오류만 기록하고 끝내기'}
              </Button>
            ) : null}
            {busy ? (
              <Button
                variant="outline"
                type="button"
                onClick={() => {
                  stop.current = true;
                }}
              >
                지금 상품까지만 하고 멈추기
              </Button>
            ) : null}
            {failed ? (
              <a
                className={buttonVariants({ variant: 'outline' })}
                data-slot="button"
                href={`/api/admin/goods-workbook?mode=failures&batch=${encodeURIComponent(view.id)}`}
              >
                <Download aria-hidden="true" />
                실패한 줄 내려받기
              </a>
            ) : null}
          </div>
          {/* 내려받을 파일이 있을 때만 그 파일로 무엇을 하는지 말한다. */}
          {failed ? (
            <p className="text-sm text-muted-foreground">
              {view.format === 'sabangnet'
                ? '엑스스퀘어 양식으로 내려받습니다. 고친 뒤 양식을 “엑스스퀘어 자체 양식”으로 바꿔 올려주세요.'
                : '고친 뒤 다시 올려주세요. 이미지 파일명을 썼다면 처음 올린 이미지 ZIP도 함께 올려주세요.'}
            </p>
          ) : null}
          {pending ? <p className="text-sm text-muted-foreground">이 작업은 24시간 동안 이어서 열 수 있습니다.</p> : null}
          <div role="region" aria-label="상품 엑셀 결과 가로 스크롤" tabIndex={0} className="relative min-w-0 overflow-x-auto rounded-lg border bg-card outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <table className="w-full min-w-[620px] table-fixed caption-bottom text-sm" data-slot="table">
              <caption className="sr-only">상품 엑셀 줄별 검증 결과</caption>
              <colgroup><col className="w-[72px]" /><col className="w-[200px]" /><col className="w-[104px]" /><col /></colgroup>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">엑셀 줄</TableHead>
                  <TableHead scope="col">상품</TableHead>
                  <TableHead scope="col">분류</TableHead>
                  <TableHead scope="col">검증·적용 결과</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.groups.map((group) => (
                  <TableRow key={group.index}>
                    <TableCell className="align-top whitespace-normal tabular-nums">{group.rows.join(', ')}</TableCell>
                    <TableCell className="align-top whitespace-normal wrap-anywhere">
                      {group.name || '이름 없음'}
                      <small className="block text-xs text-muted-foreground">
                        {group.code || '코드 자동 생성'}
                      </small>
                    </TableCell>
                    <TableCell className="align-top">
                      <AdminStatusBadge tone={statusTone('goodsImport', group.kind)}>
                        {labels[group.kind]}
                      </AdminStatusBadge>
                    </TableCell>
                    <TableCell className="align-top whitespace-normal">
                      <div className="flex flex-col items-start gap-1">
                        {group.errors.map((message) => (
                          <p key={message} className="text-sm text-destructive">
                            {message}
                          </p>
                        ))}
                        {group.kind === 'new' || group.kind === 'update' ? (() => {
                          const text = goodsImportPriceChangeText(group.priceChange);
                          if (!text) return null;
                          const reasons = [...new Set(goodsImportPriceGuardLines(group.priceChange).flatMap((line) => line.reasons))];
                          return reasons.length ? (
                            <p className={WARNING} data-price-check="true">
                              <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                              {`${text} (${goodsPriceGuardReasonText(reasons)} — 금액을 확인해주세요)`}
                            </p>
                          ) : (
                            <p className="text-sm text-muted-foreground tabular-nums" data-price-change="true">{text}</p>
                          );
                        })() : null}
                        {group.warnings.map((message) => (
                          <p key={message} className={WARNING}>
                            <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                            {message}
                          </p>
                        ))}
                        {group.result ? (
                          <p className={`text-sm ${group.result.status === 'success' ? 'text-success' : group.result.status === 'unchanged' ? 'text-muted-foreground' : 'text-destructive'}`}>
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
                          <p className={WARNING}>
                            <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                            {`이미지 ${group.skippedImages}장은 확인하지 못해 빼고 저장했습니다. 상품 편집에서 올려 주세요.`}
                          </p>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </table>
          </div>
        </AdminSectionCard>
      ) : null}
    </section>
  );
}
