import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, X } from 'lucide-react';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  onBack?: () => void;
  backLabel?: string;
  className?: string;
  protectUnsavedChanges?: boolean;
  unsavedChangesMessage?: string;
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

function getFocusableElements(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [contenteditable="true"], [tabindex]:not([tabindex="-1"])',
  )].filter((element) => isVisibleFocusable(element, root));
}

function getInitialFocusTarget(root: HTMLElement) {
  const focusable = getFocusableElements(root);
  return focusable.find((element) => !element.classList.contains('sheet-close'))
    ?? focusable[0]
    ?? root;
}

/** Tab / Shift+Tabを最前面モーダル内へ閉じ込める。 */
export function trapModalTabKey(e: KeyboardEvent, root: HTMLElement) {
  if (e.key !== 'Tab') return;
  const focusable = getFocusableElements(root);
  if (focusable.length === 0) {
    e.preventDefault();
    root.focus();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  const focusIsOutside = !(active instanceof Node) || !root.contains(active);

  // モーダル本体へフォールバックした場合も、最初のTab/Shift+Tabは
  // ブラウザ既定動作へ任せず、必ず先頭・末尾の操作要素へ送る。
  if (e.shiftKey && (active === first || active === root || focusIsOutside)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || active === root || focusIsOutside)) {
    e.preventDefault();
    first.focus();
  }
}

function sheetControlSnapshot(root: HTMLElement): string {
  return JSON.stringify([...root.querySelectorAll<HTMLElement>('input, select, textarea, [role="radio"], output')].map((element, index) => {
    const key = element.id || element.getAttribute('aria-label') || String(index);
    if (element instanceof HTMLInputElement) return ['input', key, element.type, element.value, element.checked];
    if (element instanceof HTMLSelectElement) return ['select', key, element.value];
    if (element instanceof HTMLTextAreaElement) return ['textarea', key, element.value];
    if (element.getAttribute('role') === 'radio') return ['radio', key, element.getAttribute('aria-checked')];
    return ['output', key, element.textContent?.trim() ?? ''];
  }));
}

/** モバイル向けボトムシート */
export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  onBack,
  backLabel = '前の画面へ戻る',
  className,
  protectUnsavedChanges,
  unsavedChangesMessage,
  children,
}: SheetProps) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const initialControlSnapshotRef = useRef<string | null>(null);
  const backdropPointerRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const titleId = useId();
  const dialogName = title?.trim() || '操作パネル';
  // RecordSheetは複数の呼び出し元から開かれるため、タイトル契約でも保護する。
  // 他の入力Sheetは必要に応じて明示的にopt-in / opt-outできる。
  const shouldProtectUnsavedChanges = protectUnsavedChanges ?? dialogName.includes('記録');
  const closeConfirmationMessage = unsavedChangesMessage
    ?? (dialogName.includes('記録') ? '入力中の学習記録を破棄して閉じますか？' : '保存されていない入力を破棄して閉じますか？');

  const hasUnsavedChanges = () => {
    const sheet = sheetRef.current;
    const initial = initialControlSnapshotRef.current;
    return Boolean(shouldProtectUnsavedChanges && sheet && initial !== null && sheetControlSnapshot(sheet) !== initial);
  };
  const requestClose = () => {
    if (hasUnsavedChanges() && !window.confirm(closeConfirmationMessage)) return;
    onClose();
  };
  const onCloseRef = useRef(requestClose);
  onCloseRef.current = requestClose;

  useEffect(() => {
    if (!open || !backdropRef.current) {
      initialControlSnapshotRef.current = null;
      return;
    }
    const restoreModalIsolation = acquireModalIsolation(backdropRef.current);
    // 閉じるボタンを飛ばして主要操作へ移し、他に操作要素がなければ閉じるボタンか本体へフォールバックする。
    const prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      const sheet = sheetRef.current;
      if (!sheet) return;
      getInitialFocusTarget(sheet).focus();
    });
    let snapshotFrame = 0;
    const baselineFrame = window.requestAnimationFrame(() => {
      snapshotFrame = window.requestAnimationFrame(() => {
        initialControlSnapshotRef.current = sheetRef.current ? sheetControlSnapshot(sheetRef.current) : null;
      });
    });
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    const onKey = (e: KeyboardEvent) => {
      if (backdropRef.current?.hasAttribute('inert')) return;
      if (e.key === 'Escape') {
        // 日本語IMEの変換候補を閉じるEscapeまでシートの閉操作として扱うと、
        // 入力途中の内容を失うため、composition中のキーイベントは無視する。
        if (e.isComposing || e.keyCode === 229) return;
        onCloseRef.current();
        return;
      }
      if (!sheetRef.current) return;
      trapModalTabKey(e, sheetRef.current);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(baselineFrame);
      if (snapshotFrame) window.cancelAnimationFrame(snapshotFrame);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onBeforeUnload);
      initialControlSnapshotRef.current = null;
      restoreModalIsolation();
      // 開いた元の要素が削除・非表示・inert化されている場合は、無効な場所へフォーカスを戻さない。
      if (prevFocus?.isConnected && !prevFocus.closest('[inert], [hidden], [aria-hidden="true"]')) {
        prevFocus.focus();
      }
    };
  }, [open, shouldProtectUnsavedChanges]);

  if (!open) return null;

  return createPortal(
    <div
      className="sheet-backdrop"
      ref={backdropRef}
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
        if (moved <= 10) requestClose();
      }}
      onPointerCancel={() => {
        backdropPointerRef.current = null;
      }}
    >
      <div className={`sheet${className ? ` ${className}` : ''}`} ref={sheetRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={title ? titleId : undefined} aria-label={title ? undefined : dialogName}>
        <div className="sheet-title-row">
          {onBack && (
            <button className="sheet-back" type="button" aria-label={backLabel} onClick={onBack}>
              <ArrowLeft size={19} strokeWidth={2.2} aria-hidden="true" />
            </button>
          )}
          {title && (
            <div className="sheet-title-copy">
              <h2 className="sheet-title" id={titleId}>{title}</h2>
              {subtitle && <p className="sheet-subtitle">{subtitle}</p>}
            </div>
          )}
          <button className="sheet-close" type="button" aria-label={`${dialogName}を閉じる`} onClick={requestClose}>
            <X size={18} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
