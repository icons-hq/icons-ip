import type { CsReplySurface } from './cs-reply-tools';

export interface CsReplySource {
  id: string; surface: CsReplySurface; body: string; reply: string | null; replyAt: string | null; status: 'visible' | 'hidden'; sourceVersion: string;
  revision?: string;
  rating?: number;
  imageUrls?: string[];
  imageCount?: number;
}
export function questionReplySourceVersion(answeredAt: string | null, hidden: boolean, updatedAt?: string | null) {
  return JSON.stringify([answeredAt, hidden, updatedAt ?? null]);
}
export function reviewReplySourceVersion(replyAt: string | null, editedAt: string | null, status: string) {
  return JSON.stringify([replyAt, editedAt, status]);
}
