import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { acquireModalIsolation, trapModalTabKey } from '../../../components/ui/Sheet';

export function MemoryDialog({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const backdrop = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const backdropPointerRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const titleId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!backdrop.current) return undefined;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const restoreModalIsolation = acquireModalIsolation(backdrop.current);
    const focusFrame = window.requestAnimationFrame(() => {
      if (dialog.current && !dialog.current.contains(document.activeElement)) {
        dialog.current.focus({ preventScroll: true });
      }
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (backdrop.current?.hasAttribute('inert')) return;
      if (event.key === 'Escape') {
        // 日本語IMEの変換候補を閉じるEscapeで、編集中のセット名まで失わせない。
        if (event.isComposing || event.keyCode === 229) return;
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (dialog.current) trapModalTabKey(event, dialog.current);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', onKeyDown);
      restoreModalIsolation();
      if (previous?.isConnected && !previous.closest('[inert], [hidden], [aria-hidden="true"]')) {
        previous.focus({ preventScroll: true });
      }
    };
  }, []);

  return createPortal(
    <div
      ref={backdrop}
      className="memory-dialog-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        backdropPointerRef.current = event.isPrimary
          && event.button === 0
          && event.target === event.currentTarget
          ? { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
          : null;
      }}
      onPointerUp={(event) => {
        const start = backdropPointerRef.current;
        backdropPointerRef.current = null;
        if (!start || !event.isPrimary || event.pointerId !== start.pointerId || event.target !== event.currentTarget) return;
        const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
        if (moved <= 10) onCloseRef.current();
      }}
      onPointerCancel={() => {
        backdropPointerRef.current = null;
      }}
    >
      <div
        ref={dialog}
        className="memory-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="memory-dialog-header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-btn" onClick={() => onCloseRef.current()} aria-label={`${title}を閉じる`}>
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <div className="memory-dialog-body">{children}</div>
        {footer && <div className="memory-dialog-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
