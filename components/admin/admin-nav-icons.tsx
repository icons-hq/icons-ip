import {
  Building2,
  ChartColumn,
  CircleHelp,
  Gamepad2,
  Layers,
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
} from 'lucide-react';

/* 사이드바 메뉴 그룹의 아이콘(ADR-0028 템플릿 룩 — lucide). 그룹 id가 진실원이고, 메뉴 정의
   (lib/admin/navigation.ts)의 `icon` 이름은 공개 아이콘 세트용이라 여기서 쓰지 않는다. */

/** 메뉴 그룹 아이콘. 렌더 중에 컴포넌트를 고르지 않도록(react-hooks/static-components) 그룹마다 요소를 바로 그린다. */
export function AdminNavGroupIcon({ groupId }: { groupId: string }) {
  switch (groupId) {
    case 'home': return <House />;
    case 'sales': return <ShoppingCart />;
    case 'claims': return <Undo2 />;
    case 'catalog': return <Package />;
    case 'cs': return <MessagesSquare />;
    case 'customers': return <Users />;
    case 'store': return <Store />;
    case 'display': return <Megaphone />;
    case 'stats': return <ChartColumn />;
    case 'settlements': return <Wallet />;
    case 'shipping': return <Truck />;
    case 'templates': return <LayoutTemplate />;
    case 'seller': return <Building2 />;
    case 'content': return <Sparkles />;
    case 'cards': return <Layers />;
    case 'community': return <MessagesSquare />;
    case 'games': return <Gamepad2 />;
    case 'help': return <CircleHelp />;
    default: return <LayoutGrid />;
  }
}
