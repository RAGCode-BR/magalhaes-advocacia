import { describe, expect, it } from "vitest";
import {
  ARROW_NAVIGATION_BLOCKING_SELECTOR,
  adjacentScreenIndex,
  isArrowNavigationBlocked,
  type ArrowKeyEventLike,
} from "./keyboard-screen-nav";

const screens = ["/mural", "/dashboard", "/tasks", "/clients", "/portal/"];

describe("adjacentScreenIndex", () => {
  it("moves to the next and previous screen in menu order", () => {
    expect(adjacentScreenIndex("/dashboard", screens, 1)).toBe(2);
    expect(adjacentScreenIndex("/dashboard", screens, -1)).toBe(0);
  });

  it("treats sub-pages as their menu screen", () => {
    expect(adjacentScreenIndex("/tasks/kanban", screens, 1)).toBe(3);
    expect(adjacentScreenIndex("/portal/financeiro", screens, -1)).toBe(3);
  });

  it("does not confuse screens that share a prefix", () => {
    expect(adjacentScreenIndex("/clientsx", ["/clients", "/crm"], 1)).toBe(0);
  });

  it("stops at both ends instead of wrapping around", () => {
    expect(adjacentScreenIndex("/portal/entregas", screens, 1)).toBeNull();
    expect(adjacentScreenIndex("/mural", screens, -1)).toBeNull();
    expect(adjacentScreenIndex("/portal/entregas", screens, -1)).toBe(3);
    expect(adjacentScreenIndex("/mural", screens, 1)).toBe(1);
  });

  it("starts from the ends when the current page is not in the menu", () => {
    expect(adjacentScreenIndex("/ambientes", screens, 1)).toBe(0);
    expect(adjacentScreenIndex("/ambientes", screens, -1)).toBe(4);
  });

  it("does nothing without screens", () => {
    expect(adjacentScreenIndex("/tasks", [], 1)).toBeNull();
  });
});

describe("isArrowNavigationBlocked", () => {
  const plainTarget = { closest: () => null, isContentEditable: false };
  const insideBlocking = { closest: () => ({}), isContentEditable: false };
  const event = (init: Partial<ArrowKeyEventLike> = {}): ArrowKeyEventLike => ({
    defaultPrevented: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    target: plainTarget,
    ...init,
  });

  it("allows plain arrows on the page", () => {
    expect(isArrowNavigationBlocked(event(), false)).toBe(false);
  });

  it("blocks arrows while typing or inside menus, lists and tabs", () => {
    expect(isArrowNavigationBlocked(event({ target: insideBlocking }), false)).toBe(true);
    expect(isArrowNavigationBlocked(event({ target: { closest: () => null, isContentEditable: true } }), false)).toBe(true);
    for (const part of ["input", "textarea", "select", "[contenteditable", '[role="menu"]', '[role="listbox"]', '[role="tablist"]', '[role="slider"]']) {
      expect(ARROW_NAVIGATION_BLOCKING_SELECTOR).toContain(part);
    }
  });

  it("blocks arrows with modifiers or when a component already handled them", () => {
    expect(isArrowNavigationBlocked(event({ altKey: true }), false)).toBe(true);
    expect(isArrowNavigationBlocked(event({ ctrlKey: true }), false)).toBe(true);
    expect(isArrowNavigationBlocked(event({ metaKey: true }), false)).toBe(true);
    expect(isArrowNavigationBlocked(event({ shiftKey: true }), false)).toBe(true);
    expect(isArrowNavigationBlocked(event({ defaultPrevented: true }), false)).toBe(true);
  });

  it("blocks arrows while a dialog or popover is open", () => {
    expect(isArrowNavigationBlocked(event(), true)).toBe(true);
  });
});
