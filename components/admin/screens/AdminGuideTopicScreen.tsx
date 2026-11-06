import Link from 'next/link';
import { ArrowRight, Info, OctagonAlert, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/admin/kit/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/admin/kit/ui/table';
import {
  adjacentAdminGuideTopics,
  adminGuideTopicHref,
  ADMIN_GUIDE_UPDATED_AT,
  type AdminGuideTopic,
} from '@/lib/admin/guide/topics';
import type {
  AdminGuideCallout,
  AdminGuideCalloutTone,
  AdminGuideScreenLink,
  AdminGuideSection,
} from '@/lib/admin/guide/types';
import { adminGroupForPath, adminScreenForPath } from '@/lib/admin/navigation';
import { canAccessAdminScreen, type AdminAccessSource } from '@/lib/admin/access';

/*
 * 어드민 사용 가이드 — 주제 본문 렌더러.
 *
 * 본문 데이터(lib/admin/guide)는 화면 라벨을 담지 않는다. 바로가기 chip의 라벨은
 * 렌더 시점에 내비 정본에서 조회한다 — 화면 이름이 바뀌어도 가이드가 옛 이름으로
 * 남지 않게 하기 위해서다. href가 내비에 실존하는지는 topics.test.ts가 보증한다.
 *
 * 모양은 kit 템플릿 룩(ADR-0028)이고 본문 문구는 데이터 그대로 그린다. 구역 훅은 data-guide다.
 */

const CALLOUT_TONES: Record<AdminGuideCalloutTone, { icon: typeof Info; className: string; titleClassName: string }> = {
  info: { icon: Info, className: 'bg-muted/40', titleClassName: '' },
  warning: {
    icon: TriangleAlert,
    className: 'border-[color-mix(in_oklab,var(--wc-warning)_35%,transparent)] bg-[color-mix(in_oklab,var(--wc-warning)_6%,transparent)]',
    titleClassName: 'text-[var(--wc-warning)]',
  },
  danger: { icon: OctagonAlert, className: 'border-destructive/30 bg-destructive/5', titleClassName: 'text-destructive' },
};

function screenChipLabel(href: string): string {
  const screen = adminScreenForPath(href);
  if (!screen) return href;
  const group = adminGroupForPath(href);
  return group && group.label !== screen.label ? `${group.label} › ${screen.label}` : screen.label;
}

function ScreenChip({ screen, access }: { screen: AdminGuideScreenLink; access?: AdminAccessSource }) {
  if (access !== undefined && !canAccessAdminScreen(access, adminScreenForPath(screen.href))) return null;
  return (
    <Link className="group/chip inline-flex min-h-9 max-w-full items-center gap-2 rounded-lg border bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted" data-guide="screen-chip" href={screen.href}>
      <span className="min-w-0">{screenChipLabel(screen.href)}</span>
      {screen.note && <Badge variant="secondary">{screen.note}</Badge>}
      <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-hover/chip:translate-x-0.5 group-hover/chip:text-foreground" />
    </Link>
  );
}

function CalloutCard({ callout }: { callout: AdminGuideCallout }) {
  const tone = CALLOUT_TONES[callout.tone];
  const ToneIcon = tone.icon;
  return (
    <aside className={`mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 rounded-lg border px-4 py-3 text-sm ${tone.className}`} data-guide-callout={callout.tone} role="note">
      <ToneIcon aria-hidden="true" className={`mt-0.5 size-4 ${tone.titleClassName || 'text-muted-foreground'}`} />
      <div className="flex min-w-0 flex-col gap-1">
        <p className={`font-medium ${tone.titleClassName}`}>{callout.title}</p>
        {callout.body.map((paragraph) => (
          <p className="leading-relaxed text-muted-foreground" key={paragraph}>{paragraph}</p>
        ))}
      </div>
    </aside>
  );
}

function SectionBody({ section, access }: { section: AdminGuideSection; access?: AdminAccessSource }) {
  return (
    <>
      {section.paragraphs?.map((paragraph) => (
        <p className="mb-2.5 leading-relaxed last:mb-0" key={paragraph}>{paragraph}</p>
      ))}

      {section.steps && (
        <ol className="mb-2.5 flex flex-col gap-3" data-guide="steps">
          {section.steps.map((step, index) => (
            <li className="grid min-w-0 grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2.5" key={step.text}>
              <span aria-hidden="true" className="flex size-6 items-center justify-center rounded-full border text-xs font-medium text-muted-foreground tabular-nums">{index + 1}</span>
              <div className="flex min-w-0 flex-col gap-1.5 pt-0.5">
                <p className="leading-normal font-medium">{step.text}</p>
                {step.detail && (
                  <ul className="flex list-disc flex-col gap-1 pl-4 text-[0.8125rem] leading-relaxed text-muted-foreground">
                    {step.detail.map((item) => <li className="min-w-0" key={item}>{item}</li>)}
                  </ul>
                )}
                {step.screenHref && <div><ScreenChip screen={{ href: step.screenHref }} access={access} /></div>}
              </div>
            </li>
          ))}
        </ol>
      )}

      {section.list && (
        <ul className="mb-2.5 flex list-disc flex-col gap-1.5 pl-5 leading-relaxed" data-guide="list">
          {section.list.map((item) => <li className="min-w-0" key={item}>{item}</li>)}
        </ul>
      )}

      {section.table && (
        <div className="mb-2.5 overflow-hidden rounded-lg border" data-guide="table">
          <Table className="min-w-[32.5rem] text-[0.8125rem]">
            <TableHeader className="bg-muted/50">
              <TableRow className="hover:bg-transparent">
                {section.table.columns.map((column) => <TableHead className="text-xs text-muted-foreground" key={column} scope="col">{column}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {section.table.rows.map((row) => (
                <TableRow className="hover:bg-transparent" key={row.join('|')}>
                  {row.map((cell, index) => (
                    index === 0
                      ? <TableHead className="h-auto py-2.5 align-top font-medium whitespace-normal break-keep" key={cell} scope="row">{cell}</TableHead>
                      : <TableCell className="py-2.5 align-top whitespace-normal" key={cell}>{cell}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {section.callouts?.map((callout) => <CalloutCard callout={callout} key={callout.title} />)}

      {section.screens && section.screens.length > 0 && (
        <p className="mt-3 flex flex-wrap gap-2" data-guide="screen-row">
          {section.screens.map((screen) => <ScreenChip key={screen.href} screen={screen} access={access} />)}
        </p>
      )}
    </>
  );
}

const PAGER_LINK = 'flex min-h-11 min-w-0 flex-col justify-center gap-0.5 rounded-xl bg-card px-4 py-2.5 text-sm font-medium text-card-foreground ring-1 ring-foreground/10 transition-colors hover:bg-muted/50';

export function AdminGuideTopicScreen({ topic, access }: { topic: AdminGuideTopic; access?: AdminAccessSource }) {
  const { previous, next } = adjacentAdminGuideTopics(topic.slug);

  return (
    <article className="flex w-full max-w-[55rem] min-w-0 flex-col gap-4 [overflow-wrap:anywhere]" data-guide="topic">
      <header className="flex min-w-0 flex-col gap-2">
        <Link className="w-fit text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" href="/admin/guide">← 가이드 목차</Link>
        <h2 className="text-xl leading-snug font-semibold tracking-tight text-balance break-keep">{topic.title}</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">{topic.summary}</p>
        <p className="text-xs text-muted-foreground">최종 확인 <time className="tabular-nums" dateTime={ADMIN_GUIDE_UPDATED_AT}>{ADMIN_GUIDE_UPDATED_AT}</time></p>
      </header>

      {topic.sections.length > 1 && (
        <nav aria-label="이 주제의 섹션" className="flex flex-wrap gap-2" data-guide="toc">
          {topic.sections.map((section) => (
            <a className="inline-flex min-h-8 items-center rounded-lg border bg-background px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" href={`#${section.id}`} key={section.id}>{section.heading}</a>
          ))}
        </nav>
      )}

      <div className="flex min-w-0 flex-col gap-3">
        {topic.sections.map((section) => (
          <section className="min-w-0 scroll-mt-16 rounded-xl bg-card p-4 text-sm text-card-foreground ring-1 ring-foreground/10 sm:p-5" data-guide="section" id={section.id} key={section.id}>
            <h3 className="mb-2.5 text-base leading-snug font-medium break-keep">{section.heading}</h3>
            <SectionBody section={section} access={access} />
          </section>
        ))}
      </div>

      <nav aria-label="다른 주제" className="grid grid-cols-2 gap-3" data-guide="pager">
        {previous
          ? (
            <Link className={PAGER_LINK} href={adminGuideTopicHref(previous.slug)}>
              <span className="text-xs font-normal text-muted-foreground">← 이전</span>
              {previous.navLabel}
            </Link>
          )
          : <span />}
        {next && (
          <Link className={`${PAGER_LINK} text-right`} href={adminGuideTopicHref(next.slug)}>
            <span className="text-xs font-normal text-muted-foreground">다음 →</span>
            {next.navLabel}
          </Link>
        )}
      </nav>
    </article>
  );
}
