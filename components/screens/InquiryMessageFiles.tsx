import { inquiryFileSize, inquiryFileUrl, type InquiryFile } from '@/lib/inquiry-files';
export function InquiryMessageFiles({ files = [], messageId }: { files?: InquiryFile[]; messageId: string }) {
  if (!files.length) return null;
  return <ul className="inquiry-message-files" aria-label="첨부 파일">{files.map(file => <li key={file.id}>
    {file.mimeType.startsWith('image/') ? <a href={inquiryFileUrl(file.id, messageId)} download aria-label={`${file.name} 다운로드`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={inquiryFileUrl(file.id, messageId, true)} alt={file.name} loading="lazy" /></a> : null}
    <a href={inquiryFileUrl(file.id, messageId)} download>{file.name} · {inquiryFileSize(file.size)} 다운로드</a>
  </li>)}</ul>;
}
