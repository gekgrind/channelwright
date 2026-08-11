export class UnsupportedYouTubeChannelUrlError extends Error {
  constructor(message = "Use a supported YouTube handle, channel, custom, or user URL") {
    super(message);
    this.name = "UnsupportedYouTubeChannelUrlError";
  }
}

export interface CanonicalYouTubeChannelUrl {
  canonicalUrl: string;
  sourceKind: "HANDLE" | "CHANNEL_ID" | "CUSTOM_PATH" | "USER_PATH";
  lookupValue: string;
}

const allowedHosts = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);
const safeSegment = /^[A-Za-z0-9._-]{2,160}$/;

export function canonicalizeYouTubeChannelUrl(input: string): CanonicalYouTubeChannelUrl {
  if (input.length > 500) throw new UnsupportedYouTubeChannelUrlError("YouTube channel URL is too long");
  let url: URL;
  try { url = new URL(input); } catch { throw new UnsupportedYouTubeChannelUrlError("Enter a complete YouTube channel URL"); }
  if (!['http:', 'https:'].includes(url.protocol) || !allowedHosts.has(url.hostname.toLowerCase()) || url.username || url.password || url.port) {
    throw new UnsupportedYouTubeChannelUrlError();
  }
  const segments = url.pathname.split('/').filter(Boolean).map((segment) => decodeURIComponent(segment));
  if (segments.length === 1 && segments[0].startsWith('@')) {
    const handle = segments[0].slice(1);
    if (!safeSegment.test(handle)) throw new UnsupportedYouTubeChannelUrlError("The YouTube handle is invalid");
    return { canonicalUrl: `https://www.youtube.com/@${handle}`, sourceKind: "HANDLE", lookupValue: handle };
  }
  if (segments.length === 2 && ["channel", "c", "user"].includes(segments[0]) && safeSegment.test(segments[1])) {
    const sourceKind = segments[0] === "channel" ? "CHANNEL_ID" : segments[0] === "c" ? "CUSTOM_PATH" : "USER_PATH";
    return { canonicalUrl: `https://www.youtube.com/${segments[0]}/${segments[1]}`, sourceKind, lookupValue: segments[1] };
  }
  throw new UnsupportedYouTubeChannelUrlError();
}
