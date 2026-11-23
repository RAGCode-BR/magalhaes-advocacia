// Keyboard shortcuts of the Financeiro screen: R opens "Nova receita" and D opens
// "Nova despesa". Same blocking rules as the arrow navigation: never while typing,
// with a dialog, menu or popover open, or with a modifier key held.
import { isArrowNavigationBlocked, type ArrowKeyEventLike } from "@/lib/keyboard-screen-nav";

export type FinanceShortcutEvent = ArrowKeyEventLike & { key: string; repeat?: boolean };

export function financeShortcut(
  event: FinanceShortcutEvent,
  hasOpenOverlay: boolean,
): "income" | "expense" | null {
  if (event.repeat || isArrowNavigationBlocked(event, hasOpenOverlay)) return null;
  const key = event.key.toLowerCase();
  if (key === "r") return "income";
  if (key === "d") return "expense";
  return null;
}
