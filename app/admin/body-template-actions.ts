'use server';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';
import { bodyTemplateError, normalizeBodyTemplateSave, parseBodyTemplate, parseBodyTemplateList, parseBodyTemplateReceipt,
  validBodyTemplateArchive, validBodyTemplateContext, type BodyTemplate, type BodyTemplateArchiveRequest, type BodyTemplateContext,
  type BodyTemplateList, type BodyTemplateResult, type BodyTemplateSaveRequest } from '@/lib/admin/body-templates';

const CONFIG = {
  goods: { path: '/admin/catalog/goods', capability: 'catalog.manage', list: 'admin_list_goods_body_templates', get: 'admin_get_goods_body_template', save: 'admin_save_goods_body_template', archive: 'admin_archive_goods_body_template' },
  story: { path: '/admin/display/stories', capability: 'store.manage', list: 'admin_list_story_body_templates', get: 'admin_get_story_body_template', save: 'admin_save_story_body_template', archive: 'admin_archive_story_body_template' },
} as const;
async function authorize(context: BodyTemplateContext) {
  const config = CONFIG[context.surface];
  const auth = await requireAdminActionAccess(config.path, { capability: config.capability });
  return auth && auth.user.id === context.expectedActorId.toLowerCase() ? config : null;
}
const invalid = () => ({ ok: false as const, error: '템플릿 요청을 다시 확인해주세요.' });
const denied = () => ({ ok: false as const, error: '로그인 상태나 편집 권한이 바뀌었습니다. 현재 계정으로 화면을 다시 열어주세요.' });
// PostgREST can return a transport failure as an error object rather than throw.
// Only a known database rejection proves this operation did not commit.
function writeError(error: { code?: string; message?: string }): BodyTemplateResult<never> {
  const rejected = ['22023', '42501', '28000', '23514', '23503', 'P0002', 'PT409', '23505'].includes(error.code ?? '');
  return { ok: false, error: rejected ? bodyTemplateError(error.message) : '요청 결과가 불명확합니다. 같은 요청으로 결과를 다시 확인해주세요.',
    uncertain: !rejected, conflict: error.code === 'PT409' || error.code === '23505' };
}
export async function listBodyTemplatesAction(request: BodyTemplateContext & { archived: boolean }): Promise<BodyTemplateResult<BodyTemplateList>> {
  if (!validBodyTemplateContext(request) || typeof request.archived !== 'boolean') return invalid();
  const config = await authorize(request); if (!config) return denied();
  try {
    const client = await createClient();
    const { data, error } = await client.rpc(config.list, { p_expected_actor_id: request.expectedActorId, p_archived: request.archived });
    if (error) return { ok: false, error: bodyTemplateError(error.message) };
    const value = parseBodyTemplateList(data, request.archived);
    return value ? { ok: true, value } : { ok: false, error: '템플릿 목록 응답을 확인하지 못했습니다. 다시 불러와주세요.' };
  } catch { return { ok: false, error: '템플릿 목록을 불러오지 못했습니다. 다시 시도해주세요.' }; }
}
export async function readBodyTemplateAction(request: BodyTemplateContext & { id: string }): Promise<BodyTemplateResult<BodyTemplate>> {
  if (!validBodyTemplateContext(request) || !isUuid(request.id)) return invalid();
  const config = await authorize(request); if (!config) return denied();
  try {
    const client = await createClient(); const { data, error } = await client.rpc(config.get, { p_expected_actor_id: request.expectedActorId, p_id: request.id });
    if (error) return { ok: false, error: bodyTemplateError(error.message) };
    const value = parseBodyTemplate(data, request.surface);
    return value && value.id === request.id.toLowerCase() ? { ok: true, value } : { ok: false, error: '템플릿 내용을 확인하지 못했습니다. 목록에서 다시 선택해주세요.' };
  } catch { return { ok: false, error: '템플릿을 읽지 못했습니다. 현재 입력은 유지됩니다.' }; }
}
export async function saveBodyTemplateAction(request: BodyTemplateSaveRequest): Promise<BodyTemplateResult<BodyTemplate>> {
  const normalized = normalizeBodyTemplateSave(request); if (!normalized.ok) return normalized;
  const values = normalized.value; const config = await authorize(values); if (!config) return denied();
  let result;
  try {
    const client = await createClient(); result = await client.rpc(config.save, { p_expected_actor_id: values.expectedActorId, p_id: values.id,
      p_expected_revision: values.expectedRevision, p_operation_id: values.operationId, p_name: values.name, p_body_html: values.bodyHtml });
  } catch { return { ok: false, error: '저장 결과가 불명확합니다. 같은 요청으로 결과를 다시 확인해주세요.', uncertain: true }; }
  if (result.error) return writeError(result.error);
  const receipt = parseBodyTemplateReceipt(result.data, values.id);
  if (!receipt || receipt.revision !== values.expectedRevision + 1) return { ok: false, error: '저장 결과 응답을 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.', uncertain: true };
  const read = await readBodyTemplateAction({ surface: values.surface, expectedActorId: values.expectedActorId, id: values.id });
  if (!read.ok || read.value.revision !== receipt.revision || read.value.name !== values.name || read.value.bodyHtml !== values.bodyHtml)
    return { ok: false, error: '저장은 처리됐지만 최신 본문을 대조하지 못했습니다. 입력을 유지하고 최신 저장본을 확인해주세요.', committed: { id: receipt.id, revision: receipt.revision } };
  return { ok: true, value: { ...read.value, warnings: [...new Set([...values.warnings, ...read.value.warnings])] } };
}
export async function archiveBodyTemplateAction(request: BodyTemplateArchiveRequest): Promise<BodyTemplateResult<BodyTemplate>> {
  if (!validBodyTemplateArchive(request)) return invalid();
  const config = await authorize(request); if (!config) return denied();
  let result;
  try {
    const client = await createClient(); result = await client.rpc(config.archive, { p_expected_actor_id: request.expectedActorId, p_id: request.id,
      p_expected_revision: request.expectedRevision, p_operation_id: request.operationId, p_archived: request.archived });
  } catch { return { ok: false, error: '보관·복구 결과가 불명확합니다. 같은 요청으로 다시 확인해주세요.', uncertain: true }; }
  if (result.error) return writeError(result.error);
  const receipt = parseBodyTemplateReceipt(result.data, request.id);
  if (!receipt || receipt.revision !== request.expectedRevision + 1 || (receipt.archivedAt !== null) !== request.archived)
    return { ok: false, error: '보관·복구 응답을 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.', uncertain: true };
  const read = await readBodyTemplateAction({ surface: request.surface, expectedActorId: request.expectedActorId, id: request.id });
  if (!read.ok || read.value.revision !== receipt.revision || (read.value.archivedAt !== null) !== request.archived)
    return { ok: false, error: '요청은 처리됐지만 최신 상태를 대조하지 못했습니다. 최신 저장본을 확인해주세요.', committed: { id: receipt.id, revision: receipt.revision } };
  return read;
}
