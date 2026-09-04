import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { AdminExportJob, AdminExportTemplate, ExportColumn } from './exports';

/* D-4 로더. 양식·요청 목록·권한 확인은 전부 스태프 게이트를 지나는 RPC·RLS 뒤에 있다. */

interface RpcResult {
  data: unknown;
  error: { message: string } | null;
}

function rows<Row>(result: RpcResult, what: string): Row[] {
  if (result.error) throw new Error(`Failed to load ${what}: ${result.error.message}`);
  return (result.data ?? []) as Row[];
}

interface TemplateRow {
  id: string;
  key: string | null;
  name: string;
  description: string | null;
  target: string;
  columns: ExportColumn[];
  sort: { key: string; dir: string }[];
  default_filters: Record<string, unknown>;
  security_level: string;
  file_format: string;
  is_system: boolean;
  archived_at: string | null;
}

export async function getAdminExportTemplates(): Promise<AdminExportTemplate[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('export_templates')
    .select('id,key,name,description,target,columns,sort,default_filters,security_level,file_format,is_system,archived_at')
    .is('archived_at', null)
    .order('is_system', { ascending: false })
    .order('name');
  if (error) throw new Error(`Failed to load export templates: ${error.message}`);
  return ((data ?? []) as TemplateRow[]).map((row) => ({
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    target: row.target,
    columns: row.columns ?? [],
    sort: row.sort ?? [],
    defaultFilters: row.default_filters ?? {},
    securityLevel: row.security_level,
    fileFormat: row.file_format,
    isSystem: row.is_system,
    archivedAt: row.archived_at,
  }));
}

interface JobRow {
  id: string;
  template_id: string;
  template_key: string | null;
  template_name: string;
  security_level: string;
  file_format: string;
  status: string;
  filters: Record<string, unknown>;
  reason: string | null;
  row_count: number | null;
  file_bytes: number | null;
  error: string | null;
  requested_by: string;
  requester_nickname: string | null;
  created_at: string;
  finished_at: string | null;
  expires_at: string | null;
  total_count: number;
}

export interface AdminExportJobList {
  jobs: AdminExportJob[];
  total: number;
  page: number;
  size: number;
}

export const ADMIN_EXPORT_PAGE_SIZE = 20;

export async function getAdminExportJobs(options: { status?: string | null; page?: number } = {}): Promise<AdminExportJobList> {
  const supabase = await createClient();
  const page = Math.max(1, options.page ?? 1);
  const result = await supabase.rpc('admin_list_export_jobs', {
    p_status: options.status ?? null,
    p_limit: ADMIN_EXPORT_PAGE_SIZE,
    p_offset: (page - 1) * ADMIN_EXPORT_PAGE_SIZE,
  });
  const list = rows<JobRow>(result, 'export jobs');
  return {
    jobs: list.map((row) => ({
      id: row.id,
      templateId: row.template_id,
      templateKey: row.template_key,
      templateName: row.template_name,
      securityLevel: row.security_level,
      fileFormat: row.file_format,
      status: row.status,
      filters: row.filters ?? {},
      reason: row.reason,
      rowCount: row.row_count,
      fileBytes: row.file_bytes,
      error: row.error,
      requestedBy: row.requested_by,
      requesterNickname: row.requester_nickname,
      createdAt: row.created_at,
      finishedAt: row.finished_at,
      expiresAt: row.expires_at,
    })),
    total: list[0]?.total_count ?? 0,
    page,
    size: ADMIN_EXPORT_PAGE_SIZE,
  };
}

/** 지금 로그인한 사람이 개인정보 양식을 뽑을 수 있는지. 화면이 사유 칸을 열지 말지 정한다. */
export async function currentUserCanSecureExport(): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('is_secure_exporter');
  if (error) return false;
  return data === true;
}
