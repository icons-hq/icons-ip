'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';

type AdminSelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  children?: ReactNode;
  /** The wrapper keeps the select and its conditional hint in one layout item. */
  wrapperClassName?: string;
  /** Used by flex consumers whose old direct-child selector targeted `<select>`. */
  wrapperStyle?: CSSProperties;
};

function measureSelectedText(select: HTMLSelectElement) {
  if (select.multiple || select.size > 1) return { clipped: false, selectedText: '' };
  const selectedText = select.selectedOptions[0]?.textContent?.trim() ?? '';
  if (!selectedText || select.clientWidth <= 0) return { clipped: false, selectedText };

  const style = window.getComputedStyle(select);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return { clipped: false, selectedText };

  context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const letterSpacing = Number.parseFloat(style.letterSpacing) || 0;
  const textWidth = context.measureText(selectedText).width
    + Math.max(0, selectedText.length - 1) * letterSpacing;
  const padding = (Number.parseFloat(style.paddingLeft) || 0)
    + (Number.parseFloat(style.paddingRight) || 0)
    + (Number.parseFloat(style.borderLeftWidth) || 0)
    + (Number.parseFloat(style.borderRightWidth) || 0);
  /* Native select arrows occupy platform-dependent space. Keep the estimate
     conservative without changing the select width or its native appearance. */
  const available = select.clientWidth - padding - 24;

  return { clipped: textWidth > available + 1, selectedText };
}

export const AdminSelect = forwardRef<HTMLSelectElement, AdminSelectProps>(function AdminSelect({
  'aria-describedby': ariaDescribedBy,
  children,
  onChange,
  wrapperClassName,
  wrapperStyle,
  ...selectProps
}, forwardedRef) {
  const selectRef = useRef<HTMLSelectElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const forwardedCleanupRef = useRef<(() => void) | undefined>(undefined);
  const [clipped, setClipped] = useState(false);
  const [selectedText, setSelectedText] = useState('');
  const [measured, setMeasured] = useState(false);
  const hintId = `admin-select-hint-${useId()}`;

  const setSelectRef = useCallback((node: HTMLSelectElement | null) => {
    selectRef.current = node;
    if (node === null) {
      const cleanup = forwardedCleanupRef.current;
      forwardedCleanupRef.current = undefined;
      if (cleanup) cleanup();
      else if (typeof forwardedRef === 'function') forwardedRef(null);
      if (forwardedRef && typeof forwardedRef !== 'function') forwardedRef.current = null;
    } else if (typeof forwardedRef === 'function') {
      const cleanup = forwardedRef(node);
      forwardedCleanupRef.current = typeof cleanup === 'function' ? cleanup : undefined;
    }
    else if (forwardedRef) forwardedRef.current = node;
  }, [forwardedRef]);

  const measure = useCallback(() => {
    const node = selectRef.current;
    if (!node) return;
    const result = measureSelectedText(node);
    setClipped((current) => current === result.clipped ? current : result.clipped);
    setSelectedText((current) => current === result.selectedText ? current : result.selectedText);
    setMeasured(true);
  }, []);

  const scheduleMeasure = useCallback(() => {
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = requestAnimationFrame(() => {
      animationFrameRef.current = null;
      measure();
    });
  }, [measure]);

  useEffect(() => {
    const node = selectRef.current;
    if (!node) return undefined;

    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(scheduleMeasure);
    resizeObserver?.observe(node);
    const mutationObserver = typeof MutationObserver === 'undefined'
      ? null
      : new MutationObserver(scheduleMeasure);
    mutationObserver?.observe(node, { childList: true, subtree: true, characterData: true });
    window.addEventListener('resize', scheduleMeasure);
    const form = node.form;
    form?.addEventListener('reset', scheduleMeasure);
    scheduleMeasure();

    let alive = true;
    const fontsReady = document.fonts?.ready;
    fontsReady?.then(() => { if (alive) scheduleMeasure(); }).catch(() => {});
    return () => {
      alive = false;
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      window.removeEventListener('resize', scheduleMeasure);
      form?.removeEventListener('reset', scheduleMeasure);
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    };
  }, [scheduleMeasure]);

  useEffect(() => {
    scheduleMeasure();
  }, [children, scheduleMeasure, selectProps.defaultValue, selectProps.value]);

  const handleChange = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    onChange?.(event);
    scheduleMeasure();
  }, [onChange, scheduleMeasure]);

  const describedBy = [ariaDescribedBy, clipped ? hintId : undefined].filter(Boolean).join(' ') || undefined;

  return (
    <span
      className={wrapperClassName}
      style={{ display: 'block', minWidth: 0, ...wrapperStyle }}
    >
      <select
        {...selectProps}
        aria-describedby={describedBy}
        data-admin-select-measured={measured ? 'true' : undefined}
        onChange={handleChange}
        ref={setSelectRef}
      >
        {children}
      </select>
      {clipped && selectedText ? (
        <span
          className="admin-select-hint"
          id={hintId}
          style={{
            color: 'var(--wc-ink-sub)',
            display: 'block',
            fontSize: 13,
            lineHeight: 1.65,
            marginTop: 4,
            maxWidth: '100%',
            minWidth: 0,
            overflowWrap: 'anywhere',
            whiteSpace: 'normal',
            width: '100%',
          }}
        >
          {selectedText}
        </span>
      ) : null}
    </span>
  );
});
