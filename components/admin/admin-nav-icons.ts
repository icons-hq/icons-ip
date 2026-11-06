import {
  Building2,
  CalendarCheck,
  ChartColumn,
  CircleHelp,
  House,
  LayoutGrid,
  LayoutTemplate,
  Megaphone,
  MessagesSquare,
  Package,
  ShoppingCart,
  Sparkles,
  Store,
  Truck,
  Undo2,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

/*
 * 사이드바 메뉴 그룹의 아이콘(ADR-0028 템플릿 룩 — lucide). 그룹 id가 진실원이고, 메뉴 정의
 * (lib/admin/navigation.ts)의 `icon` 이름은 공개 아이콘 세트용이라 여기서 쓰지 않는다.
 */
const ADMIN_NAV_GROUP_ICONS: Record<string, LucideIcon> = {
  home: House,
  sales: ShoppingCart,
  claims: Undo2,
  catalog: Package,
  cs: MessagesSquare,
  customers: Users,
  store: Store,
  display: Megaphone,
  stats: ChartColumn,
  settlements: Wallet,
  shipping: Truck,
  templates: LayoutTemplate,
  seller: Building2,
  content: Sparkles,
  field: CalendarCheck,
  help: CircleHelp,
};

export function adminNavGroupIcon(groupId: string): LucideIcon {
  return ADMIN_NAV_GROUP_ICONS[groupId] ?? LayoutGrid;
}
