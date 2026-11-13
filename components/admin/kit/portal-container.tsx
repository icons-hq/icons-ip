'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

/*
 * Where kit popups (Dialog, Popover, Select, DropdownMenu, ActionBar) mount.
 *
 * Base UI portals to `document.body` by default. The console tokens — and the shadcn names the
 * kit maps onto them (app/styles/admin-kit.css) — exist only under `.wc-root.wc-admin`, so a popup
 * on bare body renders with no colors, radius or font. This host keeps one body-level node with the
 * same classes the existing admin portals use (GoodsOptionImportDialog, CountryNameFinder), so popups
 * stay outside `#root`'s stacking context and inert freeze (components/shell/OverlayPortal.tsx) yet
 * still read the console tokens.
 *
 * The node is created during the first client render and attached in an effect. Popups only open
 * after an interaction, by which point it is in the document. Server renders get `undefined`, and
 * Base UI falls back to body — nothing opens on the server anyway.
 */
const AdminKitPortalContainer = createContext<HTMLElement | undefined>(undefined);

function createPortalNode() {
  if (typeof document === 'undefined') return undefined;
  const node = document.createElement('div');
  node.className = 'wc-admin admin-kit-portal';
  node.dataset.adminKitPortal = '';
  return node;
}

export function AdminKitPortalHost({ children }: { children: ReactNode }) {
  const [node] = useState(createPortalNode);
  useEffect(() => {
    if (!node) return;
    document.body.appendChild(node);
    return () => node.remove();
  }, [node]);
  return <AdminKitPortalContainer.Provider value={node}>{children}</AdminKitPortalContainer.Provider>;
}

/**
 * 팝업을 다른 곳에 띄워야 할 때(예: 네이티브 모달 `<dialog>` 안). `showModal()`로 열린 dialog는 브라우저 top layer에 있어
 * body에 붙은 팝업은 그 뒤에 가려지고 눌리지도 않는다. 그 dialog 안으로 포털을 옮긴다.
 */
export function AdminKitPortalContainerProvider({ container, children }: { container: HTMLElement | undefined; children: ReactNode }) {
  return container ? <AdminKitPortalContainer.Provider value={container}>{children}</AdminKitPortalContainer.Provider> : <>{children}</>;
}

export function useAdminKitPortalContainer() {
  return useContext(AdminKitPortalContainer);
}
