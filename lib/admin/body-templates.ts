import sanitizeHtml from 'sanitize-html';
import { sanitizeGoodsDescription } from '@/lib/goods-description';
import { sanitizeShoppingStoryContent } from '@/lib/shopping-stories-content';
import { isUuid } from '@/lib/uuid';

export const BODY_TEMPLATE_LIMIT = 50;
export const BODY_TEMPLATE_NAME_MAX = 50;
export const BODY_TEMPLATE_HTML_MAX = 30_000;
export type BodyTemplateSurface = 'goods' | 'story';
export interface BodyTemplateSummary { id: string; name: string; revision: number; archivedAt: string | null; createdAt: string; updatedAt: string; characterCount: number }
export interface BodyTemplate extends BodyTemplateSummary { bodyHtml: string; warnings: string[] }
export interface BodyTemplateList { rows: BodyTemplateSummary[]; total: number; archivedCount: number; limit: number }
export interface BodyTemplateContext { surface: BodyTemplateSurface; expectedActorId: string }
export interface BodyTemplateSaveRequest extends BodyTemplateContext { id: string; expectedRevision: number; operationId: string; name: string; bodyHtml: string }
export interface BodyTemplateArchiveRequest extends BodyTemplateContext { id: string; expectedRevision: number; operationId: string; archived: boolean }
export type BodyTemplateResult<T> = { ok: true; value: T } | { ok: false; error: string; uncertain?: boolean; conflict?: boolean; committed?: { id: string; revision: number } };
export interface BodyTemplateEditorTarget {
  bodyHtml: string;
  /** Caller rechecks its actor/session ticket, original value, and editor identity. */
  apply(html: string, mode: 'insert' | 'replace'): { ok: true; bodyHtml: string } | { ok: false; error: string };
}
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
export const bodyTemplateLength = (value: string) => Array.from(value).length;
export const isBodyTemplateSurface = (value: unknown): value is BodyTemplateSurface => value === 'goods' || value === 'story';
/** One request lane per editor identity. Late completions cannot release a newer request. */
export function createBodyTemplateRequestLane(owner: object) {
  let sequence = 0, pending = 0;
  return { owner, busy: () => pending !== 0, current: (value: number) => sequence === value,
    begin() { if (pending) return null; pending = ++sequence; return pending; },
    finish(value: number) { if (pending === value) pending = 0; },
  };
}
export function validBodyTemplateContext(value: unknown): value is BodyTemplateContext {
  return record(value) && isBodyTemplateSurface(value.surface) && isUuid(value.expectedActorId);
}
export function normalizeBodyTemplateBody(surface: BodyTemplateSurface, raw: unknown): BodyTemplateResult<{ html: string; text: string; removedImages: number; warnings: string[] }> {
  if (!isBodyTemplateSurface(surface) || typeof raw !== 'string' || bodyTemplateLength(raw) > BODY_TEMPLATE_HTML_MAX)
    return { ok: false, error: '템플릿 원문은 30,000자까지 저장할 수 있습니다. 기존 내용은 유지됩니다.' };
  const clean = surface === 'goods' ? sanitizeGoodsDescription(raw) : sanitizeShoppingStoryContent(raw);
  let removedImages = 0;
  // This pass receives only the destination's already-sanitized HTML. It removes
  // *all* images, including hosted product images that imagePaths: [] preserves.
  const html = sanitizeHtml(clean.html, { allowedTags: false, allowedAttributes: false, allowVulnerableTags: true,
    exclusiveFilter(frame) { if (frame.tag !== 'img') return false; removedImages++; return true; } }).trim();
  if (bodyTemplateLength(html) > BODY_TEMPLATE_HTML_MAX) return { ok: false, error: '정리한 템플릿 본문이 30,000자를 넘습니다. 내용을 줄여주세요.' };
  const text = sanitizeShoppingStoryContent(html).text;
  if (!text) return { ok: false, error: '템플릿에는 글이 필요합니다. 이미지나 서식만 있는 본문은 저장할 수 없습니다.' };
  const warnings = [...new Set([...clean.warnings, ...(removedImages ? [`이미지 ${removedImages}개를 제외했습니다. 템플릿에는 글과 서식만 저장됩니다.`] : [])])];
  return { ok: true, value: { html, text, removedImages, warnings } };
}
export function normalizeBodyTemplateSave(raw: unknown): BodyTemplateResult<BodyTemplateSaveRequest & { warnings: string[] }> {
  if (!validBodyTemplateContext(raw) || !record(raw) || !isUuid(raw.id) || !isUuid(raw.operationId)
    || !Number.isSafeInteger(raw.expectedRevision) || Number(raw.expectedRevision) < 0
    || typeof raw.name !== 'string' || !raw.name.trim() || bodyTemplateLength(raw.name.trim()) > BODY_TEMPLATE_NAME_MAX || /[\u0000-\u001f\u007f]/.test(raw.name)
    || Object.keys(raw).some(key => !['surface', 'expectedActorId', 'id', 'expectedRevision', 'operationId', 'name', 'bodyHtml'].includes(key)))
    return { ok: false, error: '템플릿 이름은 1~50자로 입력하고 저장 요청을 다시 확인해주세요.' };
  const body = normalizeBodyTemplateBody(raw.surface, raw.bodyHtml);
  if (!body.ok) return body;
  return { ok: true, value: { surface: raw.surface, expectedActorId: raw.expectedActorId.toLowerCase(), id: raw.id.toLowerCase(),
    expectedRevision: Number(raw.expectedRevision), operationId: raw.operationId.toLowerCase(), name: raw.name.trim(), bodyHtml: body.value.html, warnings: body.value.warnings } };
}
export function validBodyTemplateArchive(raw: unknown): raw is BodyTemplateArchiveRequest {
  return validBodyTemplateContext(raw) && record(raw) && isUuid(raw.id) && isUuid(raw.operationId)
    && Number.isSafeInteger(raw.expectedRevision) && Number(raw.expectedRevision) >= 1 && typeof raw.archived === 'boolean'
    && Object.keys(raw).every(key => ['surface', 'expectedActorId', 'id', 'expectedRevision', 'operationId', 'archived'].includes(key));
}
const instant = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
export function parseBodyTemplateSummary(value: unknown): BodyTemplateSummary | null {
  if (!record(value) || !isUuid(value.id) || typeof value.name !== 'string' || !value.name.trim() || bodyTemplateLength(value.name) > BODY_TEMPLATE_NAME_MAX
    || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1 || !(value.archivedAt === null || instant(value.archivedAt))
    || !instant(value.createdAt) || !instant(value.updatedAt) || !Number.isSafeInteger(value.characterCount) || Number(value.characterCount) < 1 || Number(value.characterCount) > BODY_TEMPLATE_HTML_MAX) return null;
  return { id: value.id, name: value.name, revision: Number(value.revision), archivedAt: value.archivedAt, createdAt: value.createdAt, updatedAt: value.updatedAt, characterCount: Number(value.characterCount) };
}
export function parseBodyTemplateList(value: unknown, archived: boolean): BodyTemplateList | null {
  if (!record(value) || value.limit !== BODY_TEMPLATE_LIMIT || !Number.isSafeInteger(value.total) || Number(value.total) < 0 || Number(value.total) > BODY_TEMPLATE_LIMIT
    || !Number.isSafeInteger(value.archivedCount) || Number(value.archivedCount) < 0 || Number(value.archivedCount) > Number(value.total) || !Array.isArray(value.rows)) return null;
  const rows = value.rows.map(parseBodyTemplateSummary);
  if (rows.some(row => !row || (row.archivedAt !== null) !== archived) || new Set(rows.map(row => row?.id)).size !== rows.length
    || rows.length !== (archived ? Number(value.archivedCount) : Number(value.total) - Number(value.archivedCount))) return null;
  return { rows: rows as BodyTemplateSummary[], total: Number(value.total), archivedCount: Number(value.archivedCount), limit: BODY_TEMPLATE_LIMIT };
}
export function parseBodyTemplate(value: unknown, surface: BodyTemplateSurface): BodyTemplate | null {
  const row = parseBodyTemplateSummary(value);
  if (!row || !record(value)) return null;
  const body = normalizeBodyTemplateBody(surface, value.bodyHtml);
  return body.ok ? { ...row, bodyHtml: body.value.html, warnings: body.value.warnings } : null;
}
export function parseBodyTemplateReceipt(value: unknown, expectedId: string): { id: string; revision: number; archivedAt: string | null; updatedAt: string } | null {
  if (!record(value) || value.id !== expectedId || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1
    || !(value.archivedAt === null || instant(value.archivedAt)) || !instant(value.updatedAt)) return null;
  return { id: expectedId, revision: Number(value.revision), archivedAt: value.archivedAt, updatedAt: value.updatedAt };
}
export function bodyTemplateError(message: string | undefined): string {
  if (message?.includes('body_template_conflict')) return '다른 탭에서 이 템플릿을 변경했습니다. 현재 입력을 유지했으니 최신 저장본을 확인해주세요.';
  if (message?.includes('operation_conflict')) return '이 요청 번호로 다른 내용이 처리됐습니다. 현재 입력을 유지하고 최신 저장본을 확인해주세요.';
  if (message?.includes('body_template_limit')) return '보관한 항목을 포함해 개인 템플릿은 50개까지입니다. 기존 템플릿의 이름과 본문을 수정해 재사용해주세요.';
  if (message?.includes('body_template_actor_changed')) return '로그인 상태가 바뀌었습니다. 현재 계정으로 화면을 다시 열어주세요.';
  if (message?.includes('body_template_not_found')) return '내 템플릿을 찾을 수 없습니다. 목록을 다시 불러와주세요.';
  if (message?.includes('operator_capability_required')) return '이 편집기의 템플릿을 관리할 권한이 필요합니다.';
  return '템플릿 요청을 처리하지 못했습니다. 입력을 유지하고 다시 확인해주세요.';
}
