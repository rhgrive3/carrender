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

const modalStack: HTMLElement[] = [];
let appRootState: { hadInert: boolean; ariaHidden: string | null } | null = null;
let portalBackgroundStates: Array<{ element: HTMLElement; hadInert: boolean; ariaHidden: string | null }> = [];
let bodyOverflowState: string | null = null;

function refreshModalIsolation() {
  modalStack.forEach((backdrop, index) => {
    const isTopmost = index === modalStack.length - 1;
    if (isTopmost) {
      backdrop.removeAttribute('inert');
      backdrop.removeAttribute('aria-hidden');
    } else {
      backdrop.setAttribute('inert', '');
      backdrop.setAttribute('aria-hidden', 'true');
    }
  });
}

function isolatePortalBackground(backdrop: HTMLElement, appRoot: HTMLElement | null) {
  portalBackgroundStates = [...document.body.children]
    .filter((element): element is HTMLElement => element instanceof HTMLElement)
    .filter((element) => element !== appRoot && element !== backdrop && !element.classList.contains('sheet-backdrop'))
    .map((element) => ({
      element,
      hadInert: element.hasAttribute('inert'),
      ariaHidden: element.getAttribute('aria-hidden'),
    }));

  portalBackgroundStates.forEach(({ element }) => {
    // 下部ナビなどbody直下へportalされたUIも、モーダル表示中は背面操作・読み上げ対象から外す。
    element.setAttribute('inert', '');
    element.setAttribute('aria-hidden', 'true');
  });
}

function restorePortalBackground() {
  portalBackgroundStates.forEach(({ element, hadInert, ariaHidden }) => {
    if (!element.isConnected) return;
    if (!hadInert) element.removeAttribute('inert');
    if (ariaHidden === null) element.removeAttribute('aria-hidden');
    else element.setAttribute('aria-hidden', ariaHidden);
  });
  portalBackgroundStates = [];
}

/**
 * body直下へportalされたモーダルを共有スタックへ登録する。
 * Sheetだけでなく全画面タイマーも同じ背景隔離・多重モーダル契約を使う。
 */
export function acquireModalIsolation(backdrop: HTMLElement) {
  const appRoot = document.getElementById('root');

  if (modalStack.length === 0) {
    bodyOverflowState = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    isolatePortalBackground(backdrop, appRoot);

    if (appRoot) {
      appRootState = {
        hadInert: appRoot.hasAttribute('inert'),
        ariaHidden: appRoot.getAttribute('aria-hidden'),
      };
      // aria-modalだけではiOS/iPadOS VoiceOverの仮想カーソルが背面へ移動できる場合がある。
      // portal先のモーダル以外をinert化し、視覚・キーボード・支援技術の操作対象を一致させる。
      appRoot.setAttribute('inert', '');
      appRoot.setAttribute('aria-hidden', 'true');
    }
  }

  modalStack.push(backdrop);
  refreshModalIsolation();

  return () => {
    const index = modalStack.lastIndexOf(backdrop);
    if (index >= 0) modalStack.splice(index, 1);
    refreshModalIsolation();

    if (modalStack.length !== 0) return;

    if (bodyOverflowState !== null) {
      document.body.style.overflow = bodyOverflowState;
      bodyOverflowState = null;
    }
    restorePortalBackground();

    if (!appRoot || !appRootState) return;
    if (!appRootState.hadInert) appRoot.removeAttribute('inert');
    if (appRootState.ariaHidden === null) appRoot.removeAttribute('aria-hidden');
    else appRoot.setAttribute('aria-hidden', appRootState.ariaHidden);
    appRootState = null;
  };
}

function isVisibleFocusable(element: HTMLElement, root: HTMLElement) {
  if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  if (element.closest('fieldset[disabled]')) return false;
  if (!root.contains(element)) return false;

  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') return false;

  return element.getClientRects().length > 0;
}

/** Tab / Shift+Tabを最前面モーダル内へ閉じ込める。 */
export function trapModalTabKey(e: KeyboardEvent, root: HTMLElement) {
  if (e.key !== 'Tab') return;
  const focusable = [...root.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [contenteditable="true"], [tabindex]:not([tabindex="-1"])',
  )].filter((element) => isVisibleFocusable(element, root));
  if (focusable.length === 0) {
    e.preventDefault();
    root.focus();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  const focusIsOutside = !(active instanceof Node) || !root.contains(active);

  // モーダル本体を初期フォーカスにしているため、最初のTab/Shift+Tabも
  // ブラウザ既定動作へ任せず、必ず先頭・末尾の操作要素へ送る。
  if (e.shiftKey && (active === first || active === root || focusIsOutside)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || active === root || focusIsOutside)) {
    e.preventDefault();
    first.focus();
  }
}

/** モバイル向けボトムシート */
export function Sheet({ open, onClose, title, children }: SheetProps) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open || !backdropRef.current) return;
    const restoreModalIsolation = acquireModalIsolation(backdropRef.current);
    // フォーカスをシートへ移し、閉じたら開いた元のボタンへ戻す
    const prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sheetRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (backdropRef.current?.hasAttribute('inert')) return;
      if (e.key === 'Escape') {
        // 日本語IMEの変換候補を閉じるEscapeまでシートの閉操作として扱うと、
        // 入力途中の内容を失うため、composition中のキーイベントは無視する。
        if (e.isComposing || e.keyCode === 229) return;
        onClose();
        return;
      }
      if (!sheetRef.current) return;
      trapModalTabKey(e, sheetRef.current);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      restoreModalIsolation();
      prevFocus?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="sheet-backdrop"
      ref={backdropRef}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sheet" ref={sheetRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={title ? titleId : undefined} aria-label={title ? undefined : 'ダイアログ'}>
        <div className="sheet-grabber" aria-hidden="true" />
        <div className="sheet-title-row">
          {title && <h2 className="sheet-title" id={titleId}>{title}</h2>}
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
