import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

/** モバイル向けボトムシート */
export function Sheet({ open, onClose, title, children }: SheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // フォーカスをシートへ移し、閉じたら開いた元のボタンへ戻す
    const prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sheetRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // 日本語IMEの変換候補を閉じるEscapeまでシートの閉操作として扱うと、
        // 入力途中の内容を失うため、composition中のキーイベントは無視する。
        if (e.isComposing || e.keyCode === 229) return;
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !sheetRef.current) return;
      const focusable = [...sheetRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      )].filter((element) => !element.hasAttribute('hidden'));
      if (focusable.length === 0) {
        e.preventDefault();
        sheetRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
      prevFocus?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="sheet-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sheet" ref={sheetRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={title ? titleId : undefined} aria-label={title ? undefined : 'ダイアログ'}>
        <div className="sheet-grabber" />
        <div className="sheet-title-row">
          {title && <div className="sheet-title" id={titleId}>{title}</div>}
          <button className="sheet-close" type="button" aria-label="閉じる" onClick={onClose}>
            <X size={18} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
