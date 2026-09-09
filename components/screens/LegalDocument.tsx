import Link from 'next/link';
import {
  LEGAL_DOCUMENTS,
  LEGAL_DOCUMENT_SLUGS,
  legalDocumentHref,
  type LegalArticle,
  type LegalDocument,
} from '@/lib/legal/documents';

/* 법정 고지 본문은 로그인 없이 읽히는 공개 화면이다(AGENTS.md 공개 브라우징).
 * 발견 화면의 시네마틱 리듬 대신 DESIGN.md의 flat-form-surface 규율을 따라
 * 흰 종이 위 긴 본문으로 조용히 읽히게 만든다. */

function ArticleBody({ article }: { article: LegalArticle }) {
  return (
    <>
      {article.paragraphs?.map((paragraph) => (
        <p key={paragraph} className="legal-doc__paragraph">{paragraph}</p>
      ))}

      {article.list && (
        <ol className="legal-doc__list">
          {article.list.map((item) => <li key={item}>{item}</li>)}
        </ol>
      )}

      {article.table && (
        <div className="legal-doc__table-scroll">
          <table className="legal-doc__table">
            <thead>
              <tr>
                {article.table.columns.map((column) => <th key={column} scope="col">{column}</th>)}
              </tr>
            </thead>
            <tbody>
              {article.table.rows.map((row) => (
                <tr key={row.join('|')}>
                  {row.map((cell, index) => (
                    index === 0
                      ? <th key={cell} scope="row">{cell}</th>
                      : <td key={cell}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {article.closing?.map((paragraph) => (
        <p key={paragraph} className="legal-doc__paragraph">{paragraph}</p>
      ))}
    </>
  );
}

export function LegalDocumentScreen({ document }: { document: LegalDocument }) {
  const others = LEGAL_DOCUMENT_SLUGS
    .filter((slug) => slug !== document.slug)
    .map((slug) => LEGAL_DOCUMENTS[slug]);

  return (
    <div className="screen legal-doc">
      <div className="wrap legal-doc__inner">
        <header className="legal-doc__head">
          <p className="eyebrow">법정 고지</p>
          <h1 className="h-xl legal-doc__title">{document.title}</h1>
          <p className="legal-doc__summary">{document.summary}</p>
          <p className="mono legal-doc__effective">시행일 {document.effectiveDate}</p>
        </header>

        <nav aria-label="다른 법정 고지" className="legal-doc__switch">
          {others.map((other) => (
            <Link key={other.slug} href={legalDocumentHref(other.slug)}>
              {other.navLabel}
              <span aria-hidden>→</span>
            </Link>
          ))}
        </nav>

        {document.pendingRevision && (
          <aside
            aria-labelledby={`${document.slug}-pending-revision-heading`}
            className="legal-doc__revision"
          >
            <p className="eyebrow legal-doc__revision-kicker">개정 사전 공지</p>
            <h2
              className="legal-doc__revision-heading"
              id={`${document.slug}-pending-revision-heading`}
            >
              {document.pendingRevision.heading}
            </h2>
            <p className="mono legal-doc__revision-meta">
              공지일 {document.pendingRevision.announcedDate}
              <span aria-hidden>·</span>
              시행 예정일 {document.pendingRevision.effectiveDate}
            </p>
            <ul className="legal-doc__revision-changes">
              {document.pendingRevision.changes.map((change) => <li key={change}>{change}</li>)}
            </ul>
          </aside>
        )}

        {document.revisionChanges && (
          <aside className="legal-doc__revision" aria-label={`${document.effectiveDate} 개정 안내`}>
            <h2 className="legal-doc__revision-heading">{document.effectiveDate} 개정 안내</h2>
            <ul className="legal-doc__revision-changes">
              {document.revisionChanges.map((change) => <li key={change}>{change}</li>)}
            </ul>
          </aside>
        )}

        <div className="legal-doc__body">
          {document.articles.map((article) => (
            <section key={article.heading} className="legal-doc__article">
              <h2 className="legal-doc__heading">{article.heading}</h2>
              <ArticleBody article={article} />
            </section>
          ))}
        </div>

        {document.previousVersion && (
          <details className="legal-doc__body">
            <summary className="legal-doc__heading">
              이전 정책 본문 (시행일 {document.previousVersion.effectiveDate})
            </summary>
            <p className="legal-doc__paragraph">
              개정 전 정책 문구를 보존합니다. 고객지원 연락처는 현재 정보로 표시합니다.
              개별 이용자의 약관 동의 기록은 아닙니다.
            </p>
            {document.previousVersion.articles.map((article) => (
              <section key={article.heading} className="legal-doc__article">
                <h3 className="legal-doc__heading">{article.heading}</h3>
                <ArticleBody article={article} />
              </section>
            ))}
          </details>
        )}
      </div>
    </div>
  );
}
