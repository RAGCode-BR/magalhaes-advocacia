import { beforeEach, describe, expect, it, vi } from "vitest";

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from } }));
import { financeRows } from "./office-finance-data";

type Row = { id: string };
const row = (id: number): Row => ({ id: id.toString().padStart(6, "0") });

beforeEach(() => from.mockReset());

describe("financial pagination", () => {
  it("continues after the last ID when earlier rows are removed between requests", async () => {
    let records = Array.from({ length: 1003 }, (_, index) => row(index + 1));
    const readPages: { cursor?: string; limit: number }[] = [];
    from.mockImplementation(() => {
      const options = { cursor: undefined as string | undefined, limit: 0 };
      const query = {
        select: () => query,
        order: () => query,
        limit: (limit: number) => {
          options.limit = limit;
          return query;
        },
        gt: (_column: string, id: string) => {
          options.cursor = id;
          return query;
        },
        then(resolve: (result: { data: Row[]; error: null }) => void) {
          const page = records
            .filter((item) => !options.cursor || item.id > options.cursor)
            .slice(0, options.limit);
          readPages.push({ ...options });
          if (readPages.length === 1) records = records.slice(5);
          resolve({ data: page, error: null });
        },
      };
      return query;
    });
    const result = await financeRows<Row>("office_finance_entries");
    expect(result).toEqual(Array.from({ length: 1003 }, (_, index) => row(index + 1)));
    expect(readPages).toEqual([
      { cursor: undefined, limit: 500 },
      { cursor: "000500", limit: 500 },
      { cursor: "001000", limit: 500 },
    ]);
  });

  it("rejects a failed later page instead of returning incomplete financial totals", async () => {
    const error = new Error("connection interrupted");
    let calls = 0;
    from.mockImplementation(() => {
      const query = {
        select: () => query,
        order: () => query,
        limit: () => query,
        gt: () => query,
        then(resolve: (result: unknown) => void) {
          calls += 1;
          resolve(
            calls === 1
              ? { data: Array.from({ length: 500 }, (_, index) => row(index + 1)), error: null }
              : { data: null, error },
          );
        },
      };
      return query;
    });
    await expect(financeRows("office_finance_entries")).rejects.toBe(error);
  });
});
