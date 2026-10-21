const CHUNK_BYTES = 4 * 1024 * 1024;
const DIRECT_BYTES = 6 * 1024 * 1024;
type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }>;
const decode = (content: string) => {
  const raw = atob(content.replace(/\s/g, ""));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
};

/** Keep every response below the Data API limit, including base64 overhead. */
export async function readNeonFile(rpc: Rpc, bucket: string, path: string) {
  const meta = await rpc("neon_file_stat", { bucket, path });
  if (meta.error) return { data: null, error: meta.error };
  if (!meta.data) return { data: null, error: new Error("Arquivo não encontrado ou acesso não permitido.") };
  const size = Number(meta.data.size);
  if (!Number.isSafeInteger(size) || size < 0 || size > 50 * 1024 * 1024)
    throw new Error("Tamanho do arquivo inválido.");
  if (size <= DIRECT_BYTES) {
    const file = await rpc("neon_file_download", { bucket, path });
    if (file.error) return { data: null, error: file.error };
    if (!file.data) throw new Error("Arquivo não encontrado ou acesso não permitido.");
    const bytes = decode(file.data.content);
    if (bytes.length !== size) throw new Error("O documento mudou durante o carregamento. Abra novamente.");
    return { data: new Blob([bytes], { type: file.data.mime || meta.data.mime || "application/octet-stream" }), error: null };
  }
  const parts: Uint8Array[] = [];
  for (let start = 0; start < size; start += CHUNK_BYTES * 3) {
    const batch = [0,1,2].map(i => start + i * CHUNK_BYTES).filter(offset => offset < size);
    const chunks = await Promise.all(batch.map(async offset => {
      const length = Math.min(CHUNK_BYTES, size-offset);
      const result = await rpc("neon_file_chunk", { bucket, path, byte_offset: offset, byte_count: length, expected_version: meta.data.version });
      if (result.error) throw result.error;
      if (!result.data) throw new Error("O documento mudou ou o acesso terminou. Abra novamente.");
      const bytes = decode(result.data.content);
      if (bytes.length !== length) throw new Error("Arquivo recebido incompleto. Tente novamente.");
      return bytes;
    }));
    parts.push(...chunks);
  }
  return { data: new Blob(parts as BlobPart[], { type: meta.data.mime || "application/octet-stream" }), error: null };
}
