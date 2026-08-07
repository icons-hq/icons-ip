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
  AdminCatalogRecords,
  AdminGameRecord,
  AdminTicketTypeRecord,
} from '@/lib/admin/catalog.server';
import type { AdminCurationRecord } from '@/lib/admin/curations.server';
import type { EmailDeliveryRecord } from '@/lib/email/deliveries.server';
import type { AdminDrawTicketGrantRecord } from '@/lib/admin/draw-ticket-grants';
import type { AdminInsights } from '@/lib/admin/insights.server';
import type { AdminModerationRecords } from '@/lib/admin/moderation.server';
import type { AdminMemberRole, AdminMemberSummary } from '@/lib/admin/members';
import type { AdminNotificationConsoleData } from '@/lib/admin/notifications';
import type { AdminOrderConsoleData } from '@/lib/admin/orders';
import type { AdminProfileRecord } from '@/lib/admin/roles.server';
import type { CatalogSnapshot } from '@/lib/catalog';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { CardSection } from './sections/CardSection';
import { CardPoolSection } from './sections/CardPoolSection';
import { CurationSection } from './sections/CurationSection';
import { EmailDeliverySection } from './sections/EmailDeliverySection';
import { DrawTicketGrantSection } from './sections/DrawTicketGrantSection';
import { EventSection } from './sections/EventSection';
import { GoodSection } from './sections/GoodSection';
import { GameSection } from './sections/GameSection';
import { IpSection } from './sections/IpSection';
import { MembersSection } from './sections/Members';
import { ModerationSection } from './sections/Moderation';
import { NotificationSection } from './sections/NotificationSection';
import { OverviewSection } from './sections/Overview';
import { OrdersSection } from './sections/Orders';
import { RewardPolicySection } from './sections/RewardPolicySection';
import { RolesSection } from './sections/Roles';
import { TicketSection } from './sections/TicketSection';

export type AdminSection = 'overview' | 'orders' | 'ip' | 'good' | 'card' | 'pool' | 'policy' | 'grants' | 'game' | 'event' | 'ticket' | 'curations' | 'notifications' | 'emails' | 'moderation' | 'members' | 'roles';

const SECTION_TITLES: Record<AdminSection, string> = {
  overview: '개요',
  orders: '주문 관리',
  ip: 'IP 관리',
  good: '굿즈 관리',
  card: '카드 관리',
  pool: '카드풀 관리',
  policy: '뽑기권 발급 정책',
  grants: '카드팩 수동 발급',
  game: '게임 관리',
  event: '이벤트 관리',
  ticket: '티켓 회차 관리',
  curations: '홈 큐레이션',
  notifications: '공지·알림 발송',
  emails: '메일 발송 이력',
  moderation: '모더레이션',
  members: '회원 관리',
  roles: '역할 관리',
};

const emptyState: AdminCatalogActionState = {};

interface AdminProps {
  admin: {
    id: string;
    email: string | null;
    role: AdminMemberRole;
  };
  catalog: Pick<CatalogSnapshot, 'verticals' | 'ips'>;
  curationDraftActiveFrom: string;
  curationDraftId: string;
  curationOperationId: string;
  curations: AdminCurationRecord[];
  drawTicketGrants: AdminDrawTicketGrantRecord[];
  emailDeliveries: EmailDeliveryRecord[];
  grantOperationId: string;
  initialSection?: AdminSection;
  insights: AdminInsights;
  moderation: AdminModerationRecords;
  members: AdminMemberSummary[];
  notificationConsole: AdminNotificationConsoleData;
  notificationOperationId: string;
  orders: AdminOrderConsoleData;
  profiles: AdminProfileRecord[];
  records: AdminCatalogRecords;
  policyDraftActiveFrom: string;
  policyDraftId: string;
  policyOperationId: string;
  poolDraftActiveFrom: string;
  poolDraftId: string;
  poolOddsOperationId: string;
  poolOperationId: string;
  stockAdjustmentId: string;
  ticketDraftId: string;
  ticketOperationId: string;
  gameEndOperationId: string;
  gameOperationId: string;
}

export function Admin({
  admin,
  catalog,
  curationDraftActiveFrom,
  curationDraftId,
  curationOperationId,
  curations,
  drawTicketGrants,
  emailDeliveries,
  grantOperationId,
  initialSection,
  insights,
  moderation,
  members,
  notificationConsole,
  notificationOperationId,
  orders,
  profiles,
  records,
  policyDraftActiveFrom,
  policyDraftId,
  policyOperationId,
  poolDraftActiveFrom,
  poolDraftId,
  poolOddsOperationId,
  poolOperationId,
  stockAdjustmentId,
  ticketDraftId,
  ticketOperationId,
  gameEndOperationId,
  gameOperationId,
}: AdminProps) {
  const [active, setActive] = useState<AdminSection>(initialSection ?? 'overview');
  const [collapsed, setCollapsed] = useState(false);
  const [selectedIpId, setSelectedIpId] = useState<string | null>(null);
  const [selectedGoodId, setSelectedGoodId] = useState<string | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedPoolId, setSelectedPoolId] = useState<string | null>(null);
  const [selectedPolicyId, setSelectedPolicyId] = useState<string | null>(null);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedTicketTypeId, setSelectedTicketTypeId] = useState<string | null>(null);
  const [selectedCurationId, setSelectedCurationId] = useState<string | null>(null);
  const [ipState, ipAction, ipPending] = useActionState(upsertAdminIpAction, emptyState);
  const [goodState, goodAction, goodPending] = useActionState(upsertAdminGoodAction, emptyState);
  const [cardState, cardAction, cardPending] = useActionState(upsertAdminCardAction, emptyState);
  const [eventState, eventAction, eventPending] = useActionState(upsertAdminEventAction, emptyState);
  const ipOptions = useMemo(
    () => records.ips
      .map((ip) => ({ id: ip.id, title: ip.title, archivedAt: ip.archivedAt })),
    [records.ips],
  );
  const eventOptions = useMemo(
    () => records.events
      .map((event) => ({ id: event.id, title: event.title, archivedAt: event.archivedAt })),
    [records.events],
  );
  const selectedIp = useMemo(
    () => records.ips.find((ip) => ip.id === selectedIpId) ?? null,
    [records.ips, selectedIpId],
  );
  const selectedGood = useMemo(
    () => records.goods.find((good) => good.id === selectedGoodId) ?? null,
    [records.goods, selectedGoodId],
  );
  const selectedCard = useMemo(
    () => records.cards.find((card) => card.id === selectedCardId) ?? null,
    [records.cards, selectedCardId],
  );
  const selectedEvent = useMemo(
    () => records.events.find((event) => event.id === selectedEventId) ?? null,
    [records.events, selectedEventId],
  );
  const selectedTicketType = useMemo(
    () => records.ticketTypes.find((ticketType) => ticketType.id === selectedTicketTypeId) ?? null,
    [records.ticketTypes, selectedTicketTypeId],
  );
  const selectedPool = useMemo(
    () => records.cardPools.find((pool) => pool.id === selectedPoolId) ?? null,
    [records.cardPools, selectedPoolId],
  );
  const selectedPolicy = useMemo(
    () => records.rewardPolicies.find((policy) => policy.id === selectedPolicyId) ?? null,
    [records.rewardPolicies, selectedPolicyId],
  );
  const selectedGame = useMemo(
    () => records.games.find((game) => game.id === selectedGameId) ?? null,
    [records.games, selectedGameId],
  );
  const selectedCuration = useMemo(
    () => curations.find((curation) => curation.id === selectedCurationId) ?? null,
    [curations, selectedCurationId],
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
                onSelect={(ip) => setSelectedIpId(ip?.id ?? null)}
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
                catalogIps={catalog.ips}
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
                onSelect={(card) => setSelectedCardId(card?.id ?? null)}
                pending={cardPending}
                poolOptions={records.cardPools.map((pool) => ({ id: pool.id, ipId: pool.ipId, name: pool.name }))}
                records={records.cards}
                selected={selectedCard}
                state={cardState}
              />
            )}
            {active === 'pool' && (
              <CardPoolSection
                cards={records.cards}
                draftActiveFrom={poolDraftActiveFrom}
                draftId={poolDraftId}
                ipOptions={ipOptions}
                oddsOperationId={poolOddsOperationId}
                onEditCard={(card) => {
                  setSelectedCardId(card.id);
                  setActive('card');
                }}
                onSelect={(pool) => setSelectedPoolId(pool?.id ?? null)}
                operationId={poolOperationId}
                records={records.cardPools}
                selected={selectedPool}
              />
            )}
            {active === 'policy' && (
              <RewardPolicySection
                draftActiveFrom={policyDraftActiveFrom}
                draftId={policyDraftId}
                goods={records.goods}
                ipOptions={ipOptions}
                onSelect={(policy) => setSelectedPolicyId(policy?.id ?? null)}
                operationId={policyOperationId}
                pools={records.cardPools}
                records={records.rewardPolicies}
                selected={selectedPolicy}
              />
            )}
            {active === 'grants' && (
              <DrawTicketGrantSection
                draftOperationId={grantOperationId}
                grants={drawTicketGrants}
                pools={records.cardPools}
              />
            )}
            {active === 'game' && (
              <GameSection
                endOperationId={gameEndOperationId}
                events={records.events}
                onSelect={(game: AdminGameRecord | null) => setSelectedGameId(game?.id ?? null)}
                operationId={gameOperationId}
                pools={records.cardPools}
                records={records.games}
                selected={selectedGame}
              />
            )}
            {active === 'event' && (
              <EventSection
                action={eventAction}
                ipOptions={ipOptions}
                onSelect={(event) => setSelectedEventId(event?.id ?? null)}
                pending={eventPending}
                records={records.events}
                selected={selectedEvent}
                state={eventState}
              />
            )}
            {active === 'ticket' && (
              <TicketSection
                draftId={ticketDraftId}
                eventOptions={records.events.map((event) => ({
                  id: event.id,
                  title: event.title,
                  archivedAt: event.archivedAt,
                }))}
                onSelect={(ticketType: AdminTicketTypeRecord | null) => setSelectedTicketTypeId(ticketType?.id ?? null)}
                operationId={ticketOperationId}
                records={records.ticketTypes}
                selected={selectedTicketType}
              />
            )}
            {active === 'curations' && (
              <CurationSection
                draftActiveFrom={curationDraftActiveFrom}
                draftId={curationDraftId}
                eventOptions={eventOptions}
                ipOptions={ipOptions}
                onOpenNotifications={() => setActive('notifications')}
                onSelect={(curation) => setSelectedCurationId(curation?.id ?? null)}
                operationId={curationOperationId}
                records={curations}
                selected={selectedCuration}
              />
            )}
            {active === 'emails' && (
              <EmailDeliverySection deliveries={emailDeliveries} />
            )}
            {active === 'notifications' && (
              <NotificationSection data={notificationConsole} operationId={notificationOperationId} />
            )}
            {active === 'moderation' && <ModerationSection reports={moderation.reports} />}
            {active === 'members' && (
              <MembersSection
                actor={{ id: admin.id, role: admin.role }}
                initialMembers={members}
                key={JSON.stringify(members.map((member) => [member.id, member.role, member.suspendedAt]))}
              />
            )}
            {active === 'roles' && admin.role === 'admin' && (
              <RolesSection adminId={admin.id} profiles={profiles} />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
