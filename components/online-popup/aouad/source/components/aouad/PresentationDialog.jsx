"use client";

import { useEffect, useRef } from "react";
import styles from "./PresentationDialog.module.css";

/**
 * Native dialogs own focus, Escape and the top layer, including nested confirmations.
 * @param {{ label: string, onClose: () => void, className?: string, children?: import('react').ReactNode, returnFocusRef?: import('react').RefObject<HTMLElement | null> | null }} props
 */
export default function PresentationDialog({ label, onClose, className = "", children, returnFocusRef = null }) {
  const dialogRef = useRef(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const previousFocus = returnFocusRef?.current ?? document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [returnFocusRef]);

  return (
    <dialog
      ref={dialogRef}
      aria-label={label}
      aria-modal="true"
      className={`${styles.dialog} ${className}`}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === dialogRef.current) onClose(); }}
    >
      {children}
    </dialog>
  );
}
