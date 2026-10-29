/** Neon service URLs derive from the public project URL, exactly like the browser client. */
export function neonServiceUrls(neonUrl: string) {
  const base = new URL(neonUrl);
  const path = base.pathname.replace(/\/$/, "");
  const at = (service: string, suffix: string) =>
    `${base.protocol}//${base.hostname.replace(".", `.${service}.`)}${path}${suffix}`;
  return { auth: at("neonauth", "/auth") };
}
