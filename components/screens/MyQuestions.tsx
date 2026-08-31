import Link from 'next/link';
import { EmptyState } from '@/components/wc/EmptyState';
import { MypageShell } from '@/components/wc/MypageShell';
import {
  formatProductQuestionDate,
  productQuestionState,
  questionStateLabel,
  type MyProductQuestion,
} from '@/lib/product-questions';
import { QuestionDeleteButton } from './QuestionDeleteButton';

/*
 * 내 상품 Q&A(#330).
 *
 * 굿즈 상세에 공개로 남긴 질문의 개인 목록이다. 비공개 1:1 표면과 목적지가 다르고
 * 어휘도 다르다 — 이 화면은 "질문"과 "답변"만 쓴다(CONTEXT.md).
 *
 * 블라인드된 글도 감추지 않는다. 사라진 줄은 왜 안 보이는지 설명하지 못해서,
 * 작성자는 자기 글이 지워졌다고만 읽게 된다(내 리뷰와 같은 규율).
 */

function QuestionCard({ question }: { question: MyProductQuestion }) {
  const state = productQuestionState(question);

  return (
    <li className="wc-mypage__card">
      <div className="wc-mypage__card-row">
        <div className="wc-mypage__card-main">
          <Link className="wc-mypage__card-title" href={question.goodPath}>
            {question.goodName}
          </Link>
          <span className="wc-mypage__card-meta">
            <time dateTime={question.createdAt}>{formatProductQuestionDate(question.createdAt)}</time>
          </span>
        </div>
        <span className={`wc-qna-badge wc-qna-badge--${state}`}>{questionStateLabel(question)}</span>
      </div>

      {/* 줄바꿈은 작성자가 넣은 내용이다 — 접으면 문단이 한 덩어리가 된다. */}
      <p className="wc-mypage__card-body" style={{ whiteSpace: 'pre-wrap' }}>{question.body}</p>

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

      {state === 'hidden' ? (
        <p className="wc-mypage__hint">
          운영 정책에 따라 비공개 처리되어 굿즈 상세에는 보이지 않습니다.
        </p>
      ) : state === 'awaiting' ? (
        <p className="wc-mypage__hint">
          운영자가 답변을 남기면 알림으로 알려드립니다.
        </p>
      ) : null}

      {/* 답변이 달린 뒤에도 열어 둔다 — 자기가 남긴 글을 거두는 것은 답변 여부와
          무관한 작성자의 권리다. 답변은 같은 행이라 함께 사라진다. */}
      <QuestionDeleteButton goodName={question.goodName} questionId={question.id} />
    </li>
  );
}

export function MyQuestions({ questions }: { questions: MyProductQuestion[] }) {
  return (
    <MypageShell active="/my/questions">
      <div className="wc-mypage__headbar">
        <h1 className="wc-mypage__headbar-title">내 상품 Q&amp;A</h1>
      </div>
      <p className="wc-mypage__lede">
        굿즈 상세에 남긴 질문과 운영자 답변입니다. 질문과 답변은 굿즈 상세에 공개됩니다.
      </p>

      {questions.length === 0 ? (
        <EmptyState
          action={<Link className="wc-mypage__headbar-link" href="/shop">굿즈 둘러보기</Link>}
          description="궁금한 굿즈의 상세 화면에서 Q&A 탭을 열면 질문을 남길 수 있어요."
          title="아직 남긴 질문이 없어요"
          titleAs="h2"
        />
      ) : (
        <section aria-labelledby="my-questions-heading">
          <div className="wc-mypage__subhead">
            <h2 id="my-questions-heading">내가 남긴 질문 {questions.length}건</h2>
          </div>
          <ul className="wc-mypage__cards">
            {questions.map((question) => (
              <QuestionCard key={question.id} question={question} />
            ))}
          </ul>
        </section>
      )}
    </MypageShell>
  );
}
