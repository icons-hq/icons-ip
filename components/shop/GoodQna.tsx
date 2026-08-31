import Link from 'next/link';
import { QuestionComposer } from '@/components/shop/QuestionComposer';
import {
  formatProductQuestionDate,
  goodQuestionsHref,
  productQuestionPageWindow,
  questionStateLabel,
} from '@/lib/product-questions';
import type { GoodQuestionSection } from '@/lib/product-questions.server';

/*
 * 굿즈 상세의 상품 Q&A 표면(#330).
 *
 * 서버 컴포넌트다. 목록에 클라이언트 상태가 없다 — 페이지는 전부 링크(URL)로
 * 움직이고, 입력 폼만 클라이언트다. 그래서 이 블록을 PDP 의 Q&A 탭에 slot 으로
 * 끼운다(리뷰 탭과 같은 구조).
 *
 * 읽기는 비로그인도 가능하다. 살지 말지를 정하는 사람은 아직 로그인하지 않은
 * 사람이라, 구매 전 질문을 로그인 뒤로 미루면 이 표면을 두는 이유가 사라진다.
 *
 * 어휘: 이 표면은 "질문"과 "답변"만 쓴다. 같은 상세 화면의 비공개 1:1 진입점과
 * 낱말이 겹치면 사용자는 자기 글이 공개인지 비공개인지 구분할 수 없다(CONTEXT.md).
 */

function QuestionItem({ question }: { question: GoodQuestionSection['questions'][number] }) {
  return (
    <li className="wc-qna-item">
      <div className="wc-qna-item__meta">
        {/* 답변 여부는 색이 아니라 글자로도 읽혀야 한다. */}
        <span className={`wc-qna-item__state${question.answerBody ? ' is-answered' : ''}`}>
          {questionStateLabel(question)}
        </span>
        <span className="wc-qna-item__author">@{question.authorName}</span>
        <time className="wc-qna-item__date" dateTime={question.createdAt}>
          {formatProductQuestionDate(question.createdAt)}
        </time>
      </div>

      {/* 줄바꿈은 작성자가 넣은 내용이다 — 접으면 문단이 한 덩어리가 된다. */}
      <p className="wc-qna-item__body" style={{ whiteSpace: 'pre-wrap' }}>{question.body}</p>

      {/* 운영 답변은 들여 붙는다 — 화자가 갈리지 않으면 다른 구매자의 말처럼 읽힌다. */}
      {question.answerBody ? (
        <div className="wc-qna-item__answer">
          <strong className="wc-qna-item__answer-author">ICONS 답변</strong>
          {question.answeredAt ? (
            <time className="wc-qna-item__date" dateTime={question.answeredAt}>
              {formatProductQuestionDate(question.answeredAt)}
            </time>
          ) : null}
          <p className="wc-qna-item__body" style={{ whiteSpace: 'pre-wrap' }}>{question.answerBody}</p>
        </div>
      ) : null}
    </li>
  );
}

export function GoodQna({
  goodId,
  section,
}: {
  goodId: string;
  section: GoodQuestionSection;
}) {
  const { count, pageCount, questions } = section;
  const currentPage = Math.min(Math.max(1, section.page), pageCount);

  return (
    <section aria-labelledby="pdp-qna-heading" className="wc-qna" id="qna">
      <h2 className="wc-sr-only" id="pdp-qna-heading">상품 Q&amp;A</h2>

      <QuestionComposer goodId={goodId} next={goodQuestionsHref(goodId, currentPage)} />

      {/* 빈 상태의 기준은 "이 페이지가 비었나"가 아니라 "질문이 하나도 없나"다 —
          범위를 벗어난 페이지에서 첫 질문을 권하면 앞 페이지의 질문들이 없던 일이 된다. */}
      {count === 0 ? (
        <p className="wc-pdp-panel__note">
          아직 등록된 질문이 없어요. 첫 질문을 남겨보세요.
        </p>
      ) : (
        <>
          <p className="wc-qna-list__count">질문 {count.toLocaleString('ko-KR')}건</p>
          {questions.length === 0 ? (
            <p className="wc-pdp-panel__note">이 페이지에는 질문이 없습니다.</p>
          ) : (
            <ul className="wc-qna-list">
              {questions.map((question) => (
                <QuestionItem key={question.id} question={question} />
              ))}
            </ul>
          )}

          {pageCount > 1 ? (
            <nav aria-label="상품 Q&amp;A 페이지" className="wc-pagination">
              {currentPage > 1 ? (
                <Link className="wc-pagination__arrow" href={goodQuestionsHref(goodId, currentPage - 1)}>
                  이전
                </Link>
              ) : null}
              {productQuestionPageWindow(currentPage, pageCount).map((page) => (
                page === currentPage ? (
                  <span key={page} aria-current="page" className="wc-pagination__cell">{page}</span>
                ) : (
                  <Link
                    key={page}
                    className="wc-pagination__cell"
                    href={goodQuestionsHref(goodId, page)}
                  >
                    {page}
                  </Link>
                )
              ))}
              {currentPage < pageCount ? (
                <Link className="wc-pagination__arrow" href={goodQuestionsHref(goodId, currentPage + 1)}>
                  다음
                </Link>
              ) : null}
            </nav>
          ) : null}
        </>
      )}
    </section>
  );
}
