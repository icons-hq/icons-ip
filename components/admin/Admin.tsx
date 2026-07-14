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
  AdminIpRecord,
  AdminTicketTypeRecord,
} from '@/lib/admin/catalog.server';
import type { AdminInsights } from '@/lib/admin/insights.server';
import type { AdminModerationRecords } from '@/lib/admin/moderation.server';
import type { AdminOrderConsoleData } from '@/lib/admin/orders';
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
import { OrdersSection } from './sections/Orders';
import { RolesSection } from './sections/Roles';
import { TicketSection } from './sections/TicketSection';

export type AdminSection = 'overview' | 'orders' | 'ip' | 'good' | 'card' | 'event' | 'ticket' | 'moderation' | 'roles';

const SECTION_TITLES: Record<AdminSection, string> = {
  overview: '개요',
  orders: '주문 관리',
  ip: 'IP 관리',
  good: '굿즈 관리',
  card: '카드 관리',
  event: '이벤트 관리',
  ticket: '티켓 회차 관리',
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
  initialSection?: AdminSection;
  insights: AdminInsights;
  moderation: AdminModerationRecords;
  orders: AdminOrderConsoleData;
  profiles: AdminProfileRecord[];
  records: AdminCatalogRecords;
  stockAdjustmentId: string;
  ticketDraftId: string;
  ticketOperationId: string;
}

export function Admin({
  admin,
  catalog,
  initialSection,
  insights,
  moderation,
  orders,
  profiles,
  records,
  stockAdjustmentId,
  ticketDraftId,
  ticketOperationId,
}: AdminProps) {
  const [active, setActive] = useState<AdminSection>(initialSection ?? 'overview');
  const [collapsed, setCollapsed] = useState(false);
  const [selectedIp, setSelectedIp] = useState<AdminIpRecord | null>(null);
  const [selectedGoodId, setSelectedGoodId] = useState<string | null>(null);
  const [selectedCard, setSelectedCard] = useState<AdminCardRecord | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<AdminEventRecord | null>(null);
  const [selectedTicketTypeId, setSelectedTicketTypeId] = useState<string | null>(null);
  const [ipState, ipAction, ipPending] = useActionState(upsertAdminIpAction, emptyState);
  const [goodState, goodAction, goodPending] = useActionState(upsertAdminGoodAction, emptyState);
  const [cardState, cardAction, cardPending] = useActionState(upsertAdminCardAction, emptyState);
  const [eventState, eventAction, eventPending] = useActionState(upsertAdminEventAction, emptyState);
  const ipOptions = useMemo(() => records.ips.map((ip) => ({ id: ip.id, title: ip.title })), [records.ips]);
  const selectedGood = useMemo(
    () => records.goods.find((good) => good.id === selectedGoodId) ?? null,
    [records.goods, selectedGoodId],
  );
  const selectedTicketType = useMemo(
    () => records.ticketTypes.find((ticketType) => ticketType.id === selectedTicketTypeId) ?? null,
    [records.ticketTypes, selectedTicketTypeId],
  );

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
            {active === 'orders' && <OrdersSection data={orders} />}
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
                adjustmentId={stockAdjustmentId}
                ipOptions={ipOptions}
                onSelect={(good) => setSelectedGoodId(good?.id ?? null)}
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
            {active === 'ticket' && (
              <TicketSection
                draftId={ticketDraftId}
                eventOptions={records.events.map((event) => ({ id: event.id, title: event.title }))}
                onSelect={(ticketType: AdminTicketTypeRecord | null) => setSelectedTicketTypeId(ticketType?.id ?? null)}
                operationId={ticketOperationId}
                records={records.ticketTypes}
                selected={selectedTicketType}
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
