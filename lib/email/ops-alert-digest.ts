/*
 * 운영 알림 요약 메일 본문(OPS-095). 순수 함수 — 네트워크·DB·env를 모른다.
 *
 * 받는 사람은 운영자(어드민 계정이 있는 업무 주소)다. 건수·분류·어드민 링크·자동 작업 이름만 싣는다.
 * 문의 제목·본문·고객 이름·연락처·주문번호는 이 메일에 들어오지 않는다(DB 요약 행에도 없다).
 */
import { escapeHtml } from './templates';

export interface OpsAlertDigestCounts {
  inquiries: number; questions: number; delayedInquiries: number; delayedQuestions: number; system: number;
}
export interface OpsAlertDigestDelayed { kind: 'inquiry' | 'question'; href: string; waitedHours: number }
export interface OpsAlertDigestJobContent {
  /** 요약을 만든 시각(ISO). 제목에는 쓰지 않고 본문 머리에만 KST로 적는다. */
  createdAt: string;
  counts: OpsAlertDigestCounts;
  systemTitles: string[];
  /** 가장 오래 기다린 순 10건까지. 전체 건수는 counts다. */
  delayed: OpsAlertDigestDelayed[];
}

const INQUIRIES_PATH = '/admin/cs/inquiries';
const QUESTIONS_PATH = '/admin/cs/qna?status=unanswered';
const SYSTEM_PATH = '/admin/settings/system';
const SETTINGS_PATH = '/admin/settings/system#ops-alert-digest';
const n = (value: number) => value.toLocaleString('ko-KR');

function kstStamp(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  return parts;
}

export function renderOpsAlertDigestEmail(job: OpsAlertDigestJobContent, siteUrl: string) {
  const { counts } = job;
  const delayed = counts.delayedInquiries + counts.delayedQuestions;
  const headline = [
    counts.inquiries ? `새 문의 ${n(counts.inquiries)}건` : '',
    counts.questions ? `새 상품 Q&A ${n(counts.questions)}건` : '',
    delayed ? `답변 지연 ${n(delayed)}건` : '',
    counts.system ? `시스템 장애 ${n(counts.system)}건` : '',
  ].filter(Boolean);
  const subject = `[엑스스퀘어] 운영 알림 — ${headline.join(' · ')}`;
  const stamp = kstStamp(job.createdAt);
  const link = (path: string) => `${siteUrl}${path}`;

  const sections: { title: string; lines: string[]; href: string; hrefLabel: string }[] = [];
  if (counts.system) {
    sections.push({ title: `시스템 장애 ${n(counts.system)}건`,
      lines: job.systemTitles, href: link(SYSTEM_PATH), hrefLabel: '시스템 상태 열기' });
  }
  if (delayed) {
    const parts = [counts.delayedInquiries ? `1:1 문의 ${n(counts.delayedInquiries)}건` : '', counts.delayedQuestions ? `상품 Q&A ${n(counts.delayedQuestions)}건` : '']
      .filter(Boolean).join(', ');
    const waited = job.delayed.length ? Math.max(...job.delayed.map((entry) => entry.waitedHours)) : 0;
    sections.push({ title: `답변 지연 ${n(delayed)}건`,
      lines: [`${parts} — 답변 기준 시간을 넘겼습니다${waited ? `(가장 오래 기다린 건 ${n(waited)}시간)` : ''}.`],
      href: link(INQUIRIES_PATH), hrefLabel: '고객 문의 열기' });
  }
  if (counts.inquiries) sections.push({ title: `새 1:1 문의 ${n(counts.inquiries)}건`, lines: [], href: link(INQUIRIES_PATH), hrefLabel: '고객 문의 열기' });
  if (counts.questions) sections.push({ title: `새 상품 Q&A ${n(counts.questions)}건`, lines: [], href: link(QUESTIONS_PATH), hrefLabel: '답변 없는 상품 Q&A 열기' });

  const delayedLinks = [...new Set(job.delayed.map((entry) => link(entry.href)))];
  const footer = '이 메일은 엑스스퀘어 어드민의 운영 알림 메일 설정에 따라 보냅니다. 고객 이름·문의 내용은 담지 않으니 링크로 어드민에서 확인해주세요. 받지 않으려면 설정에서 주소를 빼주세요.';
  const text = [
    `${stamp ? `${stamp} 기준 ` : ''}엑스스퀘어 운영 알림입니다.`,
    '',
    ...sections.flatMap((section) => [`■ ${section.title}`, ...section.lines.map((line) => `- ${line}`), `  ${section.hrefLabel}: ${section.href}`, '']),
    ...(delayedLinks.length ? ['기다리는 문의 바로가기', ...delayedLinks.map((url) => `- ${url}`), ''] : []),
    `알림 범주·받는 주소 설정: ${link(SETTINGS_PATH)}`,
    '',
    footer,
  ].join('\n');
  const html = `<h1 style="font-size:18px">${escapeHtml(subject)}</h1>`
    + `<p>${escapeHtml(`${stamp ? `${stamp} 기준 ` : ''}엑스스퀘어 운영 알림입니다.`)}</p>`
    + sections.map((section) => `<h2 style="font-size:15px;margin:16px 0 4px">${escapeHtml(section.title)}</h2>`
      + (section.lines.length ? `<ul>${section.lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>` : '')
      + `<p><a href="${escapeHtml(section.href)}">${escapeHtml(section.hrefLabel)}</a></p>`).join('')
    + (delayedLinks.length ? `<h2 style="font-size:15px;margin:16px 0 4px">기다리는 문의 바로가기</h2><ul>${delayedLinks.map((url) => `<li><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></li>`).join('')}</ul>` : '')
    + `<p><a href="${escapeHtml(link(SETTINGS_PATH))}">알림 범주·받는 주소 설정</a></p>`
    + `<p style="color:#666;font-size:12px">${escapeHtml(footer)}</p>`;
  return { subject, text, html };
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** DB 선점 결과의 요약 내용. 모양이 틀리면 null(그 작업은 발송하지 않고 결과 불명으로 남긴다). */
export function parseOpsAlertDigestContent(value: unknown): OpsAlertDigestJobContent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const raw = row.counts && typeof row.counts === 'object' && !Array.isArray(row.counts) ? row.counts as Record<string, unknown> : null;
  if (!raw || typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt))) return null;
  const counts = { inquiries: count(raw.inquiries), questions: count(raw.questions), delayedInquiries: count(raw.delayedInquiries),
    delayedQuestions: count(raw.delayedQuestions), system: count(raw.system) };
  if (Object.values(counts).some((entry) => entry === null)) return null;
  const typed = counts as OpsAlertDigestCounts;
  if (typed.inquiries + typed.questions + typed.delayedInquiries + typed.delayedQuestions + typed.system < 1) return null;
  if (!Array.isArray(row.systemTitles) || !row.systemTitles.every((title) => typeof title === 'string')) return null;
  if (!Array.isArray(row.delayed)) return null;
  const delayed: OpsAlertDigestDelayed[] = [];
  for (const entry of row.delayed) {
    const item = entry && typeof entry === 'object' ? entry as Record<string, unknown> : null;
    const waitedHours = count(item?.waitedHours);
    // 어드민 안쪽 경로만 받는다(메일 링크에 외부 주소가 섞이지 않게).
    if (!item || (item.kind !== 'inquiry' && item.kind !== 'question') || typeof item.href !== 'string'
      || !/^\/admin\/[A-Za-z0-9/_?=&.-]*$/.test(item.href) || waitedHours === null) return null;
    delayed.push({ kind: item.kind, href: item.href, waitedHours });
  }
  return { createdAt: row.createdAt, counts: typed, systemTitles: row.systemTitles as string[], delayed };
}
