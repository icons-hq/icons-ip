"use client";

import { useEffect, useRef } from "react";
import styles from "./PresentationDialog.module.css";

/** Native dialogs own focus, Escape and the top layer, including nested confirmations. */
export default function PresentationDialog({ label, onClose, className = "", children }) {
  const dialogRef = useRef(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const previousFocus = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

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
