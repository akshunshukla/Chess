export function parseCorsOrigins(value: string | undefined, production: boolean): string[] {
  const configured = value?.trim();
  if (!configured && production) throw new Error("CORS_ORIGINS is required in production");
  const origins = (configured || "http://localhost:5173").split(",").map((origin) => origin.trim());
  for (const origin of origins) {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new Error("CORS_ORIGINS must contain exact HTTP or HTTPS origins");
    }
    if (origin.includes("*") || (url.protocol !== "http:" && url.protocol !== "https:") || url.origin !== origin) {
      throw new Error("CORS_ORIGINS must contain exact HTTP or HTTPS origins without paths or trailing slashes");
    }
  }
  return [...new Set(origins)];
}

export function isOriginAllowed(origin: string | undefined, origins: readonly string[], allowMissing: boolean): boolean {
  return origin === undefined ? allowMissing : origins.includes(origin);
}
