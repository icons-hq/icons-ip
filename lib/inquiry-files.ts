import { isUuid } from './uuid';
import { transactionRecord } from './goods-transaction-values';

export const INQUIRY_FILES_BUCKET = 'inquiry-files-private';
export const INQUIRY_FILE_MAX_BYTES = 20 * 1024 * 1024;
export const INQUIRY_FILE_LIBRARY_LIMIT = 100;
export const INQUIRY_MESSAGE_FILE_LIMIT = 3;
export const INQUIRY_FILE_MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4',
  'application/pdf': 'pdf', 'text/plain': 'txt', 'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx', 'application/vnd.ms-powerpoint': 'ppt',
  'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'application/x-hwp': 'hwp',
};
export const INQUIRY_FILE_ACCEPT = '.jpg,.jpeg,.png,.webp,.gif,.mp4,.pdf,.txt,.xls,.xlsx,.ppt,.doc,.docx,.hwp';
export const INQUIRY_FILE_FORMATS = 'JPG·PNG·WebP·GIF·MP4·PDF·TXT·XLS·XLSX·PPT·DOC·DOCX·HWP';
export interface InquiryFile { id: string; name: string; mimeType: string; size: number }
export function parseInquiryFile(value: unknown): InquiryFile | null {
  if (!transactionRecord(value) || !isUuid(value.id) || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 160
    || /[\u0000-\u001f\u007f/\\]/.test(value.name) || typeof value.mimeType !== 'string' || !Object.hasOwn(INQUIRY_FILE_MIME_EXTENSIONS, value.mimeType)
    || !Number.isSafeInteger(value.size) || Number(value.size) < 1 || Number(value.size) > INQUIRY_FILE_MAX_BYTES) return null;
  const extension = value.name.trim().split('.').at(-1)?.toLowerCase();
  const canonical = INQUIRY_FILE_MIME_EXTENSIONS[value.mimeType];
  if (!value.name.includes('.') || extension !== canonical && !(canonical === 'jpg' && extension === 'jpeg')) return null;
  return { id: value.id, name: value.name.trim(), mimeType: value.mimeType, size: Number(value.size) };
}
export function inquiryFileFromUpload(file: Pick<File, 'name' | 'type' | 'size'>, id: string): InquiryFile | null {
  const extension = file.name.split('.').at(-1)?.toLowerCase();
  const mimeType = Object.entries(INQUIRY_FILE_MIME_EXTENSIONS).find(([, value]) => value === extension || value === 'jpg' && extension === 'jpeg')?.[0];
  return mimeType ? parseInquiryFile({ id, name: file.name, mimeType, size: file.size }) : null;
}
export function inquiryFileUrl(fileId: string, messageId?: string, preview = false) {
  const params = new URLSearchParams({ fileId });
  if (messageId) params.set('messageId', messageId);
  if (preview) params.set('preview', '1');
  return `/api/inquiries/files?${params}`;
}
export function inquiryFileSize(size: number) { return size < 1024 * 1024 ? `${Math.ceil(size / 1024)}KB` : `${(size / (1024 * 1024)).toFixed(1)}MB`; }
