import { describe, expect, it } from "vitest";
import { FINAL_STAGE, newStageId, nextStagePosition, orderStages } from "./crm-stages";

const row = (stage_id: string, position: number | null) => ({
  stage_id,
  label: stage_id,
  color: "#000000",
  position,
});

describe("orderStages", () => {
  it("sorts by saved position and always keeps the fixed closing column last", () => {
    const ordered = orderStages([row(FINAL_STAGE, 0), row("b", 2), row("a", 1), row("c", null)]);
    expect(ordered.map((stage) => stage.id)).toEqual(["a", "b", "c", FINAL_STAGE]);
    expect(ordered.at(-1)).toMatchObject({ id: FINAL_STAGE, fixed: true });
    expect(ordered[0].fixed).toBe(false);
  });
});

describe("newStageId / nextStagePosition", () => {
  it("creates ids the database accepts and places new columns before the fixed one", () => {
    expect(newStageId()).toMatch(/^c_[a-z0-9]{8}$/);
    expect(newStageId()).not.toBe(newStageId());
    expect(nextStagePosition(orderStages([row("a", 3), row(FINAL_STAGE, 50)]))).toBe(4);
    expect(nextStagePosition(orderStages([row(FINAL_STAGE, 50)]))).toBe(0);
    expect(nextStagePosition(orderStages([row("a", 49)]))).toBe(49);
  });
});
