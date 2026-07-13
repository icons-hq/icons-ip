'use client';

import { useActionState, useMemo, useState } from 'react';
import {
  upsertAdminCardAction,
  upsertAdminEventAction,
  upsertAdminGoodAction,
  upsertAdminIpAction,
  type AdminCatalogActionState,
} from '@/app/admin/actions';
import type {
  AdminCardRecord,
  AdminCatalogRecords,
  AdminEventRecord,
  AdminGoodRecord,
  AdminIpRecord,
} from '@/lib/admin/catalog.server';
import type { AdminInsights } from '@/lib/admin/insights.server';
import type { AdminModerationRecords } from '@/lib/admin/moderation.server';
import type { AdminProfileRecord } from '@/lib/admin/roles.server';
import type { CatalogSnapshot } from '@/lib/catalog';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { CardSection } from './sections/CardSection';
import { EventSection } from './sections/EventSection';
import { GoodSection } from './sections/GoodSection';
import { IpSection } from './sections/IpSection';
import { ModerationSection } from './sections/Moderation';
import { OverviewSection } from './sections/Overview';
import { RolesSection } from './sections/Roles';

export type AdminSection = 'overview' | 'ip' | 'good' | 'card' | 'event' | 'moderation' | 'roles';

const SECTION_TITLES: Record<AdminSection, string> = {
  overview: '개요',
  ip: 'IP 관리',
  good: '굿즈 관리',
  card: '카드 관리',
  event: '이벤트 관리',
  moderation: '모더레이션',
  roles: '역할 관리',
};

const emptyState: AdminCatalogActionState = {};

interface AdminProps {
  admin: {
    id: string;
    email: string | null;
    role: string;
  };
  catalog: Pick<CatalogSnapshot, 'verticals' | 'ips'>;
  insights: AdminInsights;
  moderation: AdminModerationRecords;
  profiles: AdminProfileRecord[];
  records: AdminCatalogRecords;
}

export function Admin({ admin, catalog, insights, moderation, profiles, records }: AdminProps) {
  const [active, setActive] = useState<AdminSection>('overview');
  const [collapsed, setCollapsed] = useState(false);
  const [selectedIp, setSelectedIp] = useState<AdminIpRecord | null>(null);
  const [selectedGood, setSelectedGood] = useState<AdminGoodRecord | null>(null);
  const [selectedCard, setSelectedCard] = useState<AdminCardRecord | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<AdminEventRecord | null>(null);
  const [ipState, ipAction, ipPending] = useActionState(upsertAdminIpAction, emptyState);
  const [goodState, goodAction, goodPending] = useActionState(upsertAdminGoodAction, emptyState);
  const [cardState, cardAction, cardPending] = useActionState(upsertAdminCardAction, emptyState);
  const [eventState, eventAction, eventPending] = useActionState(upsertAdminEventAction, emptyState);
  const ipOptions = useMemo(() => records.ips.map((ip) => ({ id: ip.id, title: ip.title })), [records.ips]);

  return (
    <div className={collapsed ? 'admin-shell collapsed' : 'admin-shell'}>
      <Sidebar
        active={active}
        collapsed={collapsed}
        onCollapsedChange={setCollapsed}
        onSectionChange={setActive}
        showRoles={admin.role === 'admin'}
      />
      <div className="admin-main">
        <Header admin={admin} title={SECTION_TITLES[active]} />
        <main className="admin-content">
          <div key={active} className="rise">
            {active === 'overview' && (
              <OverviewSection
                insights={insights}
                onOpenModeration={() => setActive('moderation')}
                reports={moderation.reports}
              />
            )}
            {active === 'ip' && (
              <IpSection
                action={ipAction}
                onSelect={setSelectedIp}
                pending={ipPending}
                records={records.ips}
                selected={selectedIp}
                state={ipState}
                verticals={catalog.verticals}
              />
            )}
            {active === 'good' && (
              <GoodSection
                action={goodAction}
                ipOptions={ipOptions}
                onSelect={setSelectedGood}
                pending={goodPending}
                records={records.goods}
                selected={selectedGood}
                state={goodState}
              />
            )}
            {active === 'card' && (
              <CardSection
                action={cardAction}
                ipOptions={ipOptions}
                onSelect={setSelectedCard}
                pending={cardPending}
                records={records.cards}
                selected={selectedCard}
                state={cardState}
              />
            )}
            {active === 'event' && (
              <EventSection
                action={eventAction}
                ipOptions={ipOptions}
                onSelect={setSelectedEvent}
                pending={eventPending}
                records={records.events}
                selected={selectedEvent}
                state={eventState}
              />
            )}
            {active === 'moderation' && <ModerationSection reports={moderation.reports} />}
            {active === 'roles' && admin.role === 'admin' && (
              <RolesSection adminId={admin.id} profiles={profiles} />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
