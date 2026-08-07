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

        <div className="legal-doc__body">
          {document.articles.map((article) => (
            <section key={article.heading} className="legal-doc__article">
              <h2 className="legal-doc__heading">{article.heading}</h2>
              <ArticleBody article={article} />
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
