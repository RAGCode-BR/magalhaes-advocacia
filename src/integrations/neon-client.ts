import { createNeonSessionBridge } from "./neon-session";
import { readNeonFile } from "./neon-file-transfer";
import { createNeonFileLoader } from "./neon-file-loader";
import { hashPassword } from "@better-auth/utils/password";
import { createClient, SupabaseAuthAdapter } from "@neondatabase/neon-js";

/** Browser code receives only public service URLs. The PostgreSQL password stays server-side. */
export function createNeonBrowserClient(url: string, accessToken?: string) {
  const base = new URL(url);
  const serviceUrl = (service: string, suffix: string) =>
    `${base.protocol}//${base.hostname.replace(".", `.${service}.`)}${base.pathname}${suffix}`;
  const authClient = accessToken ? null : createClient({
    auth: { url: serviceUrl("neonauth", "/auth"), adapter: SupabaseAuthAdapter() },
    dataApi: { url: serviceUrl("apirest", "/rest/v1") },
  });
  const sessionBridge = authClient ? createNeonSessionBridge(authClient.auth) : null;
  // Every module (including mural, notifications and offline replay) shares the
  // verified JWT path rather than the SDK's independent session-cache path.
  const client = createClient({
    dataApi: { url: serviceUrl("apirest", "/rest/v1"), getToken: accessToken ? async () => accessToken : sessionBridge!.getToken },
  });
  const avatarUrls = new Map<string, string>();
  const channels = new Set<{ unsubscribe: () => void }>();
  const failed = (message: string) => ({ data: null, error: new Error(message) });
  const fileLoader = createNeonFileLoader((bucket, path) =>
    readNeonFile((name, args) => client.rpc(name, args), bucket, path),
  );
  if (!accessToken) {
    let identity: string | null | undefined;
    sessionBridge!.auth.onAuthStateChange((event: string, session: any) => {
      const next = session?.user?.id ?? null;
      if (event === "SIGNED_OUT" || (identity !== undefined && identity !== next)) fileLoader.clear();
      identity = next;
    });
  }
  const storage = {
    from(bucket: string) {
      const download = (path: string) => fileLoader.download(bucket, path);
      const signed = async (path: string, seconds = 3600) => {
        const result = await download(path);
        if (result.error || !result.data) return { data: null, error: result.error };
        const signedUrl = URL.createObjectURL(result.data);
        setTimeout(() => URL.revokeObjectURL(signedUrl), seconds * 1000);
        return { data: { path, signedUrl }, error: null };
      };
      return {
        async upload(
          path: string,
          file: Blob,
          options?: { upsert?: boolean; contentType?: string },
        ) {
          if (file.size > 50 * 1024 * 1024) return failed("O arquivo deve ter até 50 MB.");
          const content = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });
          const result = await client.rpc("neon_file_upload", {
            bucket,
            path,
            content: content.split(",")[1],
            mime: options?.contentType || file.type,
            overwrite: Boolean(options?.upsert),
          });
          if (!result.error) fileLoader.clear();
          if (!result.error && bucket === "profile-avatars") avatarUrls.set(path, content);
          return result;
        },
        download,
        async remove(paths: string[]) {
          const result = await client.rpc("neon_file_remove", { bucket, paths });
          if (!result.error) fileLoader.clear();
          return result;
        },
        createSignedUrl: signed,
        async createSignedUrls(paths: string[], seconds: number) {
          const results = await Promise.all(paths.map((path) => signed(path, seconds)));
          return {
            data: results.map((r, i) => ({
              path: paths[i],
              signedUrl: r.data?.signedUrl ?? "",
              error: r.error?.message,
            })),
            error: results.find((r) => r.error)?.error ?? null,
          };
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: avatarUrls.get(path) || "" } }),
      };
    },
  };
  // PG17 has no native Neon Realtime. Poll through the same RLS-protected Data API
  // and emit actual row changes, rather than bypassing authorization via a server key.
  const channel = () => {
    const listeners: any[] = [];
    let timer: ReturnType<typeof setInterval> | undefined;
    let running = false;
    const tick = async () => {
      if (running || document.hidden) return;
      running = true;
      try {
        for (const listener of listeners) {
          let query = client.from(listener.config.table).select("*").limit(1000);
          if (listener.config.filter) {
            const match = /^([^=]+)=eq\.(.*)$/.exec(listener.config.filter);
            if (match) query = query.eq(match[1], match[2]);
          }
          const { data, error } = await query;
          if (error || !data) continue;
          const rows = new Map(data.map((row: any) => [row.id ?? JSON.stringify(row), row]));
          if (listener.previous) {
            const emit = (eventType: string, next: any, old: any) => {
              if (listener.config.event === "*" || listener.config.event === eventType)
                listener.callback({
                  eventType,
                  new: next,
                  old,
                  schema: "public",
                  table: listener.config.table,
                });
            };
            for (const [id, row] of rows) {
              const old = listener.previous.get(id);
              if (!old) emit("INSERT", row, {});
              else if (JSON.stringify(old) !== JSON.stringify(row)) emit("UPDATE", row, old);
            }
            for (const [id, row] of listener.previous) if (!rows.has(id)) emit("DELETE", {}, row);
          }
          listener.previous = rows;
        }
      } finally {
        running = false;
      }
    };
    const result = {
      on(type: string, config: any, callback: any) {
        if (type === "postgres_changes") listeners.push({ config, callback });
        return result;
      },
      subscribe(callback?: (status: string) => void) {
        void tick();
        timer = setInterval(tick, 10000);
        channels.add(result);
        callback?.("SUBSCRIBED");
        return result;
      },
      unsubscribe() {
        clearInterval(timer);
        channels.delete(result);
      },
    };
    return result;
  };
  const functions = {
    async invoke(name: string, options: any) {
      if (name === "admin-user-access") {
        const { action, data } = options.body;
        if (action === "create") {
          if (!data.fullName?.trim()) return failed("Informe o nome completo.");
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email?.trim() || ""))
            return failed("Informe um e-mail válido.");
          if (
            typeof data.password !== "string" ||
            data.password.length < 8 ||
            data.password.length > 128
          )
            return failed("A senha inicial deve ter entre 8 e 128 caracteres.");
          // Compatible with Better Auth; only the salted scrypt hash reaches SQL.
          const { password, ...account } = data;
          const passwordHash = await hashPassword(password);
          return client.rpc("neon_admin_access", { action, data: { ...account, passwordHash } });
        }
        return client.rpc("neon_admin_access", { action, data });
      }
      return failed(
        "Esta integração externa ainda precisa de configuração no servidor da Magalhães.",
      );
    },
  };
  return new Proxy(client, {
    get(target, key) {
      if (key === "auth" && sessionBridge) return sessionBridge.auth;
      if (key === "storage") return storage;
      if (key === "functions") return functions;
      if (key === "channel") return channel;
      if (key === "removeChannel") return (entry: any) => entry.unsubscribe();
      if (key === "removeAllChannels")
        return () => channels.forEach((entry) => entry.unsubscribe());
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
