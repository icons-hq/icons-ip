import Link from 'next/link';
import {
  adjacentAdminGuideTopics,
  adminGuideTopicHref,
  type AdminGuideTopic,
} from '@/lib/admin/guide/topics';
import type {
  AdminGuideCallout,
  AdminGuideScreenLink,
  AdminGuideSection,
} from '@/lib/admin/guide/types';
import { adminGroupForPath, adminScreenForPath } from '@/lib/admin/navigation';

/*
 * 어드민 사용 가이드 — 주제 본문 렌더러.
 *
 * 본문 데이터(lib/admin/guide)는 화면 라벨을 담지 않는다. 바로가기 chip의 라벨은
 * 렌더 시점에 내비 정본에서 조회한다 — 화면 이름이 바뀌어도 가이드가 옛 이름으로
 * 남지 않게 하기 위해서다. href가 내비에 실존하는지는 topics.test.ts가 보증한다.
 */

function screenChipLabel(href: string): string {
  const screen = adminScreenForPath(href);
  if (!screen) return href;
  const group = adminGroupForPath(href);
  return group && group.label !== screen.label ? `${group.label} › ${screen.label}` : screen.label;
}

function ScreenChip({ screen }: { screen: AdminGuideScreenLink }) {
  return (
    <Link className="admin-guide-screen-chip" href={screen.href}>
      <span>{screenChipLabel(screen.href)}</span>
      {screen.note && <span className="admin-guide-screen-chip__note">{screen.note}</span>}
      <span aria-hidden>→</span>
    </Link>
  );
}

function CalloutCard({ callout }: { callout: AdminGuideCallout }) {
  return (
    <aside className={`admin-guide-callout admin-guide-callout--${callout.tone}`} role="note">
      <p className="admin-guide-callout__title">{callout.title}</p>
      {callout.body.map((paragraph) => (
        <p key={paragraph} className="admin-guide-callout__body">{paragraph}</p>
      ))}
    </aside>
  );
}

function SectionBody({ section }: { section: AdminGuideSection }) {
  return (
    <>
      {section.paragraphs?.map((paragraph) => (
        <p key={paragraph} className="admin-guide-paragraph">{paragraph}</p>
      ))}

      {section.steps && (
        <ol className="admin-guide-steps">
          {section.steps.map((step) => (
            <li key={step.text}>
              <p className="admin-guide-step-text">{step.text}</p>
              {step.detail && (
                <ul className="admin-guide-step-detail">
                  {step.detail.map((item) => <li key={item}>{item}</li>)}
                </ul>
              )}
              {step.screenHref && <ScreenChip screen={{ href: step.screenHref }} />}
            </li>
          ))}
        </ol>
      )}

      {section.list && (
        <ul className="admin-guide-list">
          {section.list.map((item) => <li key={item}>{item}</li>)}
        </ul>
      )}

      {section.table && (
        <div className="admin-guide-table-scroll">
          <table className="admin-guide-table">
            <thead>
              <tr>
                {section.table.columns.map((column) => <th key={column} scope="col">{column}</th>)}
              </tr>
            </thead>
            <tbody>
              {section.table.rows.map((row) => (
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

      {section.callouts?.map((callout) => <CalloutCard callout={callout} key={callout.title} />)}

      {section.screens && section.screens.length > 0 && (
        <p className="admin-guide-screen-row">
          {section.screens.map((screen) => <ScreenChip key={screen.href} screen={screen} />)}
        </p>
      )}
    </>
  );
}

export function AdminGuideTopicScreen({ topic }: { topic: AdminGuideTopic }) {
  const { previous, next } = adjacentAdminGuideTopics(topic.slug);

  return (
    <article className="admin-guide-doc">
      <header className="admin-guide-doc__head">
        <Link className="admin-guide-back" href="/admin/guide">← 가이드 목차</Link>
        <h2 className="admin-guide-doc__title">{topic.title}</h2>
        <p className="admin-guide-doc__summary">{topic.summary}</p>
      </header>

      {topic.sections.length > 1 && (
        <nav aria-label="이 주제의 섹션" className="admin-guide-toc">
          {topic.sections.map((section) => (
            <a href={`#${section.id}`} key={section.id}>{section.heading}</a>
          ))}
        </nav>
      )}

      <div className="admin-guide-doc__body">
        {topic.sections.map((section) => (
          <section className="admin-guide-section" id={section.id} key={section.id}>
            <h3 className="admin-guide-section__heading">{section.heading}</h3>
            <SectionBody section={section} />
          </section>
        ))}
      </div>

      <nav aria-label="다른 주제" className="admin-guide-pager">
        {previous
          ? (
            <Link className="admin-guide-pager__link" href={adminGuideTopicHref(previous.slug)}>
              <span className="admin-guide-pager__hint">← 이전</span>
              {previous.navLabel}
            </Link>
          )
          : <span />}
        {next && (
          <Link className="admin-guide-pager__link admin-guide-pager__link--next" href={adminGuideTopicHref(next.slug)}>
            <span className="admin-guide-pager__hint">다음 →</span>
            {next.navLabel}
          </Link>
        )}
      </nav>
    </article>
  );
}
