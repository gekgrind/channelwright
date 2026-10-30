"use client";

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE = 'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * A modal confirmation used by every review decision.
 *
 * - Rendered in a portal; every other child of <body> is `inert` while open, so
 *   the page behind it cannot be focused or clicked.
 * - Tab and Shift+Tab wrap inside the dialog.
 * - Escape closes it unless `dismissible` is false (e.g. while sending).
 * - Initial focus goes to `initialFocus` (the safe action for destructive
 *   dialogs); on close, focus returns to `returnFocus` when `restoreFocus`
 *   still says so and the invoker is still in the document.
 */
export function ConfirmDialog({ title, description, children, alert = false, dismissible, onDismiss, initialFocus, returnFocus, restoreFocus }: {
  title: ReactNode;
  description: ReactNode;
  children: ReactNode;
  /** Destructive or irreversible: announced as an alertdialog. */
  alert?: boolean;
  dismissible: boolean;
  onDismiss: () => void;
  initialFocus: RefObject<HTMLElement | null>;
  returnFocus: RefObject<HTMLElement | null>;
  /** Read on close: false when another region (e.g. a success notice) owns focus next. */
  restoreFocus: RefObject<boolean>;
}) {
  const id = useId();
  const backdrop = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const own = backdrop.current;
    const made = [...document.body.children].filter((element) => element !== own && !element.hasAttribute("inert"));
    for (const element of made) element.setAttribute("inert", "");
    (initialFocus.current ?? dialog.current)?.focus();
    const invoker = returnFocus.current;
    return () => {
      for (const element of made) element.removeAttribute("inert");
      // Read at close time on purpose: success hands focus to the workspace notice.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      if (restoreFocus.current && invoker?.isConnected) invoker.focus();
    };
    // Mount-only: the dialog's lifetime is the effect's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      if (dismissible) onDismiss();
      return;
    }
    if (event.key !== "Tab" || !dialog.current) return;
    const focusable = [...dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (focusable.length === 0) { event.preventDefault(); dialog.current.focus(); return; }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === dialog.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
  };

  return createPortal(
    <div ref={backdrop} className="review-dialog-backdrop">
      <div ref={dialog} className="review-dialog" role={alert ? "alertdialog" : "dialog"} aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-body`} tabIndex={-1} onKeyDown={onKeyDown}>
        <h2 id={`${id}-title`}>{title}</h2>
        <div id={`${id}-body`} className="review-dialog-body">{description}</div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
