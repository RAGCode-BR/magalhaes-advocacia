// Arrow-key navigation between the main menu screens while the top bar is
// minimized. The keys must never steal arrows from typing, menus, lists or
// components that already use them.

export const ARROW_NAVIGATION_BLOCKING_SELECTOR = [
  "input",
  "textarea",
  "select",
  "[contenteditable]:not([contenteditable='false'])",
  '[role="textbox"]',
  '[role="combobox"]',
  '[role="menu"]',
  '[role="menubar"]',
  '[role="listbox"]',
  '[role="tablist"]',
  '[role="slider"]',
  '[role="radiogroup"]',
  '[role="grid"]',
  '[role="tree"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
  "[data-radix-popper-content-wrapper]",
].join(",");

/** Overlays that keep arrows for themselves while open (dialogs, popovers, menus). */
export const OPEN_OVERLAY_SELECTOR = [
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
  '[role="menu"][data-state="open"]',
  "[data-radix-popper-content-wrapper]",
].join(",");

type ArrowTarget = { closest?: (selector: string) => unknown; isContentEditable?: boolean };

export type ArrowKeyEventLike = {
  defaultPrevented: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  target: ArrowTarget | EventTarget | null;
};

export function isArrowNavigationBlocked(event: ArrowKeyEventLike, hasOpenOverlay: boolean) {
  if (event.defaultPrevented || hasOpenOverlay) return true;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return true;
  const target = event.target as ArrowTarget | null;
  if (!target) return false;
  if (target.isContentEditable) return true;
  return typeof target.closest === "function" && target.closest(ARROW_NAVIGATION_BLOCKING_SELECTOR) != null;
}

/**
 * Index of the screen before/after the current one in menu order, or null at
 * the first/last screen (navigation stops there, it does not wrap). `matches`
 * are path prefixes ("/tasks" also covers "/tasks/kanban"; a trailing "/" such
 * as "/portal/" covers only its sub-pages).
 */
export function adjacentScreenIndex(pathname: string, matches: readonly string[], direction: 1 | -1) {
  if (matches.length === 0) return null;
  const current = matches.findIndex((match) =>
    match.endsWith("/") ? pathname.startsWith(match) : pathname === match || pathname.startsWith(match + "/"),
  );
  if (current === -1) return direction === 1 ? 0 : matches.length - 1;
  const next = current + direction;
  return next < 0 || next >= matches.length ? null : next;
}
