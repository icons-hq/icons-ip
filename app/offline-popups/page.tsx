import { Events } from '@/components/screens/Events';
import { getCatalogSnapshot } from '@/lib/catalog';
import { selectOfflinePopupEvents } from '@/lib/events-catalog';
import { listEventGameLinks } from '@/lib/games/catalog';

/* 오프라인 팝업 목록.
 *
 * 카탈로그는 온라인 이벤트도 같은 배열에 담는다 — 이 표면은 오프라인만 맡으므로
 * 넘기기 전에 걸러낸다(온라인 팝업의 정본 자리는 IP 관이다, CONTEXT.md).
 *
 * 상세 `/offline-popups/[eventId]`는 건드리지 않는다. 이미 나간 예매 링크와 딥링크가
 * 그 주소를 가리키고 있어서, 목록을 정리한 김에 상세까지 404로 만들면 화면 정리가
 * 진행 중인 예매 동선을 끊는다. 목록에서 사라질 뿐 주소를 아는 사람은 계속 들어온다는
 * 절충이고, 온라인 이벤트를 어느 표면이 소유할지는 별도 이사 작업의 몫이다. */

export default async function Page({ searchParams }: { searchParams: Promise<{ ip?: string | string[] }> }) {
  const [catalog, gameLinks] = await Promise.all([getCatalogSnapshot(), listEventGameLinks()]);
  const events = selectOfflinePopupEvents(catalog.events);
  const ipParam = (await searchParams).ip;
  const requestedIp = Array.isArray(ipParam) ? ipParam[0] : ipParam;
  /* IP 칩은 걸러낸 목록에서 나온다 — 원본으로 검증하면 온라인 이벤트만 가진 IP 가
     선택된 채 열려, 지울 수 없는 필터 뒤에 빈 목록이 남는다. */
  const initialIpId = events.some((event) => event.ip === requestedIp) ? requestedIp : undefined;
  return <Events catalog={{ ...catalog, events }} initialIpId={initialIpId} gameLinks={gameLinks} />;
}
