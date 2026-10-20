import 'server-only';
import { ADMIN_GUIDE_TOPIC_SLUGS, ADMIN_GUIDE_TOPICS } from './guide/topics';
import { adminScreenForPath } from './navigation';
import { canAccessAdminScreen, type AdminAccessSource } from './access';
import type { AdminHelpResult } from './operations-dock';

export function searchAdminOperationHelp(query: string, pathname: string, access: AdminAccessSource | boolean): AdminHelpResult {
  const needle = query.trim().toLocaleLowerCase('ko-KR').slice(0, 100);
  const current = adminScreenForPath(pathname)?.href;
  const rows = ADMIN_GUIDE_TOPIC_SLUGS.flatMap(slug => {
    const topic = ADMIN_GUIDE_TOPICS[slug];
    return topic.sections.flatMap(section => {
      const links = (section.screens ?? []).filter(link => typeof access === 'boolean'
        ? access || !adminScreenForPath(link.href)?.adminOnly
        : canAccessAdminScreen(access, adminScreenForPath(link.href)))
        .map(link => ({ href: link.href, label: adminScreenForPath(link.href)?.label ?? link.href }));
      if (section.screens?.length && !links.length) return [];
      const paragraphs = [
        ...(section.paragraphs ?? []), ...(section.list ?? []),
        ...(section.steps ?? []).flatMap((step, index) => [`${index + 1}. ${step.text}`, ...(step.detail ?? [])]),
        ...(section.callouts ?? []).flatMap(callout => [callout.title, ...callout.body]),
        ...(section.table?.rows ?? []).map(row => row.join(' · ')),
      ];
      const search = [topic.title, topic.navLabel, section.heading, ...paragraphs].join(' ').toLocaleLowerCase('ko-KR');
      if (needle && !search.includes(needle)) return [];
      return [{ id: `${slug}/${section.id}`, title: section.heading, topic: topic.navLabel, href: `/admin/guide/${slug}#${section.id}`, paragraphs, links,
        related: Boolean(current && links.some(link => link.href === current)) }];
    });
  });
  rows.sort((a, b) => Number(b.related) - Number(a.related));
  return { entries: rows.slice(0, needle ? 50 : 12).map(row => ({ id: row.id, title: row.title, topic: row.topic, href: row.href, paragraphs: row.paragraphs, links: row.links })), total: rows.length };
}
