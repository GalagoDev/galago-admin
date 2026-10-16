function parsedOrigin(value: string): string | null {
  // Origin has only a scheme and authority: reject credentials, paths, multiple
  // origins and URL parser normalization of whitespace or backslashes.
  if (!/^https?:\/\/[^/?#\\\s,@]+$/i.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

/** Match the browser-visible origin forwarded by the hosting reverse proxy. */
export function isSameOriginRequest(request: Request): boolean {
  const origin = parsedOrigin(request.headers.get("origin") || "");
  if (!origin) return false;
  const url = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const host = forwardedHost === null ? request.headers.get("host") ?? url.host : forwardedHost.split(",")[0].trim();
  const protocol = forwardedProto === null ? url.protocol.slice(0, -1) : forwardedProto.split(",")[0].trim();
  if (!/^https?$/.test(protocol)) return false;
  return origin === parsedOrigin(`${protocol}://${host}`);
}
