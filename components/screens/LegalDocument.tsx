import Link from 'next/link';
import {
  LEGAL_DOCUMENTS,
  LEGAL_DOCUMENT_SLUGS,
  legalDocumentHref,
  type LegalArticle,
  type LegalDocument,
} from '@/lib/legal/documents';

/* 법정 고지 본문 (DESIGN §6 document-page · R-06 §8 · 11 §8 EV-05).
 *
 * 로그인 없이 읽히는 공개 화면이다(AGENTS.md 공개 브라우징). 레퍼런스 정책 문서처럼
 * 620px 한 칼럼(본문 580) 안에 가운데 제목 → 본문을 둔다: 조항 제목 h2 20/700,
 * 본문 p 14/1.6. 개정 공지·표·이전 판(details)은 그대로 싣는다.
 *
 * 서버 컴포넌트이고 쿠키·세션을 읽지 않는다 — /legal/[document] 는 generateStaticParams 로
 * 정적 생성되는 라우트라, 여기서 요청 단위 값을 읽는 순간 SSG 가 dynamic 으로 무너진다(#325). */

function ArticleBody({ article }: { article: LegalArticle }) {
  return (
    <>
      {article.paragraphs?.map((paragraph) => (
        <p key={paragraph} className="wc-document__paragraph">{paragraph}</p>
      ))}

      {article.list && (
        <ol className="wc-document__list">
          {article.list.map((item) => <li key={item}>{item}</li>)}
        </ol>
      )}

      {article.table && (
        /* 좁은 화면에서는 표만 가로로 스크롤한다 — 본문 칼럼을 표 폭으로 늘리지 않는다. */
        <div className="wc-document__table-scroll">
          <table className="wc-document__table">
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
        <p key={paragraph} className="wc-document__paragraph">{paragraph}</p>
      ))}
    </>
  );
}

export function LegalDocumentScreen({ document }: { document: LegalDocument }) {
  const others = LEGAL_DOCUMENT_SLUGS
    .filter((slug) => slug !== document.slug)
    .map((slug) => LEGAL_DOCUMENTS[slug]);

  return (
    <div className="wc-root wc-document">
      <article className="wc-document__page">
        <header className="wc-document__head">
          <h1 className="wc-document__title">{document.title}</h1>
          <p className="wc-document__summary">{document.summary}</p>
          <p className="wc-document__effective">시행일 {document.effectiveDate}</p>
          <nav aria-label="다른 법정 고지" className="wc-document__switch">
            {others.map((other) => (
              <Link key={other.slug} href={legalDocumentHref(other.slug)}>{other.navLabel}</Link>
            ))}
          </nav>
        </header>

        {document.pendingRevision && (
          <aside
            aria-labelledby={`${document.slug}-pending-revision-heading`}
            className="wc-document__notice"
          >
            <p className="wc-document__notice-kicker">개정 사전 공지</p>
            <h2
              className="wc-document__notice-heading"
              id={`${document.slug}-pending-revision-heading`}
            >
              {document.pendingRevision.heading}
            </h2>
            <p className="wc-document__notice-meta">
              공지일 {document.pendingRevision.announcedDate}
              <span aria-hidden>·</span>
              시행 예정일 {document.pendingRevision.effectiveDate}
            </p>
            <ul className="wc-document__notice-list">
              {document.pendingRevision.changes.map((change) => <li key={change}>{change}</li>)}
            </ul>
          </aside>
        )}

        {document.revisionChanges && (
          <aside className="wc-document__notice" aria-label={`${document.effectiveDate} 개정 안내`}>
            <h2 className="wc-document__notice-heading">{document.effectiveDate} 개정 안내</h2>
            <ul className="wc-document__notice-list">
              {document.revisionChanges.map((change) => <li key={change}>{change}</li>)}
            </ul>
          </aside>
        )}

        <div className="wc-document__body">
          {document.articles.map((article) => (
            <section key={article.heading} className="wc-document__article">
              <h2 className="wc-document__heading">{article.heading}</h2>
              <ArticleBody article={article} />
            </section>
          ))}
        </div>

        {document.previousVersion && (
          <details className="wc-document__previous">
            <summary className="wc-document__previous-summary">
              이전 정책 본문 (시행일 {document.previousVersion.effectiveDate})
            </summary>
            <div className="wc-document__previous-body">
              <p className="wc-document__paragraph">
                개정 전 정책 문구를 보존합니다. 고객지원 연락처는 현재 정보로 표시합니다.
                개별 이용자의 약관 동의 기록은 아닙니다.
              </p>
              {document.previousVersion.articles.map((article) => (
                <section key={article.heading} className="wc-document__article">
                  <h3 className="wc-document__heading wc-document__heading--previous">{article.heading}</h3>
                  <ArticleBody article={article} />
                </section>
              ))}
            </div>
          </details>
        )}
      </article>
    </div>
  );
}
