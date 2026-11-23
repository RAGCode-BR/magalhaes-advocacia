import { describe, expect, it } from "vitest";
import { financeShortcut, type FinanceShortcutEvent } from "./finance-shortcuts";

const press = (key: string, extra: Partial<FinanceShortcutEvent> = {}): FinanceShortcutEvent => ({
  key,
  defaultPrevented: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  target: { closest: () => null },
  ...extra,
});

describe("financeShortcut", () => {
  it("opens a new income with R and a new expense with D, in either case", () => {
    expect(financeShortcut(press("r"), false)).toBe("income");
    expect(financeShortcut(press("R"), false)).toBe("income");
    expect(financeShortcut(press("d"), false)).toBe("expense");
    expect(financeShortcut(press("x"), false)).toBeNull();
  });

  it("never fires while typing, with an overlay open, a modifier held or a held-down key", () => {
    const typing = { closest: (selector: string) => (selector.includes("input") ? {} : null) };
    expect(financeShortcut(press("r", { target: typing }), false)).toBeNull();
    expect(financeShortcut(press("r", { target: { isContentEditable: true } }), false)).toBeNull();
    expect(financeShortcut(press("r"), true)).toBeNull();
    expect(financeShortcut(press("r", { metaKey: true }), false)).toBeNull();
    expect(financeShortcut(press("d", { ctrlKey: true }), false)).toBeNull();
    expect(financeShortcut(press("d", { altKey: true }), false)).toBeNull();
    expect(financeShortcut(press("d", { repeat: true }), false)).toBeNull();
    expect(financeShortcut(press("d", { defaultPrevented: true }), false)).toBeNull();
  });
});
