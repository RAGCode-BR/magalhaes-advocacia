type FileResult = { data: Blob | null; error: any };

/** Private to one authenticated client. Bounded memory and a small download queue. */
export function createNeonFileLoader(
  fetchFile: (bucket: string, path: string) => Promise<FileResult>,
  { maxBytes = 32 * 1024 * 1024, ttlMs = 60_000, concurrency = 3 } = {},
) {
  const cache = new Map<string, { blob: Blob; expires: number }>();
  const pending = new Map<string, Promise<FileResult>>();
  const queue: (() => void)[] = [];
  let bytes = 0, active = 0, generation = 0;
  const pump = () => {
    while (active < concurrency && queue.length) queue.shift()!();
  };
  const clear = () => { generation++; cache.clear(); pending.clear(); bytes = 0; };
  const download = (bucket: string, path: string): Promise<FileResult> => {
    const key = JSON.stringify([bucket, path]);
    const found = cache.get(key);
    if (found && found.expires > Date.now()) {
      cache.delete(key); cache.set(key, found);
      return Promise.resolve({ data: found.blob, error: null });
    }
    if (found) { cache.delete(key); bytes -= found.blob.size; }
    if (pending.has(key)) return pending.get(key)!;
    const started = generation;
    const promise = new Promise<FileResult>((resolve) => {
      queue.push(() => {
        active++;
        void (async () => {
          try {
            if (started !== generation) throw new Error("A sessão mudou. Abra o arquivo novamente.");
            const result = await fetchFile(bucket, path);
            if (started !== generation) throw new Error("A sessão mudou. Abra o arquivo novamente.");
            if (!result.error && result.data && result.data.size <= maxBytes) {
              while (bytes + result.data.size > maxBytes && cache.size) {
                const oldest = cache.keys().next().value!;
                bytes -= cache.get(oldest)!.blob.size; cache.delete(oldest);
              }
              cache.set(key, { blob: result.data, expires: Date.now() + ttlMs });
              bytes += result.data.size;
            }
            resolve(result);
          } catch (error) { resolve({ data: null, error }); }
          finally {
            if (started === generation) pending.delete(key);
            active--; pump();
          }
        })();
      });
    });
    pending.set(key, promise); pump();
    return promise;
  };
  return { download, clear };
}
