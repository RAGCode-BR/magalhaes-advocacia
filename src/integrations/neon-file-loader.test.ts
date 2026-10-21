import { afterEach, describe, expect, it, vi } from "vitest";
import { createNeonFileLoader } from "./neon-file-loader";

afterEach(() => vi.useRealTimers());
describe("private Neon file downloads", () => {
  it("shares concurrent opens and reuses the bytes when reopening", async () => {
    let finish!: (value: any) => void;
    const fetch = vi.fn(() => new Promise<any>(resolve => { finish = resolve; }));
    const loader = createNeonFileLoader(fetch);
    const first = loader.download("tasks", "one.pdf");
    const second = loader.download("tasks", "one.pdf");
    expect(fetch).toHaveBeenCalledTimes(1);
    const blob = new Blob(["PDF"]); finish({ data: blob, error: null });
    expect((await first).data).toBe(blob); expect((await second).data).toBe(blob);
    expect((await loader.download("tasks", "one.pdf")).data).toBe(blob);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("bounds parallel downloads instead of flooding the API", async () => {
    const finishes: (() => void)[] = [];
    const fetch = vi.fn(() => new Promise<any>(resolve => finishes.push(() => resolve({ data: new Blob(["file"]), error: null }))));
    const loader = createNeonFileLoader(fetch, { concurrency: 2 });
    const jobs = [1,2,3].map(n => loader.download("tasks", String(n)));
    expect(fetch).toHaveBeenCalledTimes(2);
    finishes[0](); await jobs[0]; await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(3);
    finishes[1](); finishes[2](); await Promise.all(jobs);
  });
  it("does not retain files beyond the memory budget or expiry", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => ({ data: new Blob(["abc"]), error: null }));
    const loader = createNeonFileLoader(fetch, { maxBytes: 4, ttlMs: 100 });
    await loader.download("tasks", "a"); await loader.download("tasks", "b");
    await loader.download("tasks", "a"); expect(fetch).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(101); await loader.download("tasks", "a");
    expect(fetch).toHaveBeenCalledTimes(4);
  });
  it("keeps buckets and authenticated client instances separate", async () => {
    const fetch = vi.fn(async () => ({ data: new Blob(["private"]), error: null }));
    const first = createNeonFileLoader(fetch), otherUser = createNeonFileLoader(fetch);
    await first.download("one", "file"); await first.download("two", "file");
    await otherUser.download("one", "file"); expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("discards in-flight results on account change and retries failures", async () => {
    let finish!: (value: any) => void;
    const fetch = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce({ data: null, error: new Error("temporary") })
      .mockResolvedValue({ data: new Blob(["new user"]), error: null });
    const loader = createNeonFileLoader(fetch);
    const old = loader.download("tasks", "a"); loader.clear(); finish({ data: new Blob(["old user"]), error: null });
    expect((await old).data).toBeNull();
    expect((await loader.download("tasks", "a")).error).toBeTruthy();
    expect(await (await loader.download("tasks", "a")).data!.text()).toBe("new user");
  });
});
