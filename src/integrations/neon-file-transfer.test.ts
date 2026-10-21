import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { readNeonFile } from "./neon-file-transfer";

describe("Neon documents beyond the Data API response limit", () => {
  it("reassembles a large private PDF in order without a whole-file response", async () => {
    const size = 8 * 1024 * 1024 + 13;
    const original = Buffer.alloc(size);
    for (let i = 0; i < size; i++) original[i] = Math.floor(i / (1024 * 1024)) + 1;
    const rpc = vi.fn(async (name: string, args: any) => {
      if (name === "neon_file_stat") return { data: { size, mime: "application/pdf", version: "version-1" }, error: null };
      expect(name).toBe("neon_file_chunk");
      expect(args.expected_version).toBe("version-1");
      expect(args.bucket).toBe("private"); expect(args.path).toBe("document.pdf");
      expect(args.byte_count).toBeLessThanOrEqual(4 * 1024 * 1024);
      return { data: { content: original.subarray(args.byte_offset, args.byte_offset + args.byte_count).toString("base64") }, error: null };
    });
    const result = await readNeonFile(rpc, "private", "document.pdf");
    expect(result.error).toBeNull(); expect(result.data!.type).toBe("application/pdf");
    expect(createHash("sha256").update(Buffer.from(await result.data!.arrayBuffer())).digest("hex"))
      .toBe(createHash("sha256").update(original).digest("hex"));
    expect(rpc.mock.calls.some(([name]) => name === "neon_file_download")).toBe(false);
  });
  it("uses the short path for small files and keeps their original content", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: { size: 3, mime: "text/plain", version: "v1" }, error: null })
      .mockResolvedValueOnce({ data: { content: "YWJj", mime: "text/plain" }, error: null });
    const result = await readNeonFile(rpc, "private", "small");
    expect(await result.data!.text()).toBe("abc");
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(["neon_file_stat", "neon_file_download"]);
  });
  it("does not request file content if metadata access is denied", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: new Error("denied") }));
    expect((await readNeonFile(rpc, "private", "secret")).data).toBeNull();
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("rejects a changed or incomplete file instead of displaying corrupted bytes", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: { size: 7 * 1024 * 1024, version: "old" }, error: null })
      .mockResolvedValue({ data: null, error: null });
    await expect(readNeonFile(rpc, "private", "changed")).rejects.toThrow("documento mudou");
  });
});
