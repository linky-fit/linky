import React from "react";
import { isNativePlatform } from "../platform/runtime";
import { isRecord } from "../utils/unknown";
import { asNonEmptyString } from "../utils/validation";

interface LinkPreview {
  description: string | null;
  faviconUrl: string | null;
  imageUrl: string | null;
  siteName: string;
  title: string;
  url: string;
}

interface LinkPreviewCardProps {
  url: string;
}

const HOSTED_APP_ORIGIN = "https://app.linky.fit";
const MAX_PREVIEW_CACHE_SIZE = 200;
const NEGATIVE_PREVIEW_CACHE_TTL_MS = 60_000;

interface PreviewCacheEntry {
  cachedAtMs: number;
  preview: LinkPreview | null;
}

const previewCache = new Map<string, PreviewCacheEntry>();
const previewRequests = new Map<string, Promise<LinkPreview | null>>();

const parseLinkPreview = (value: unknown): LinkPreview | null => {
  if (!isRecord(value)) return null;
  const title = asNonEmptyString(value.title);
  const siteName = asNonEmptyString(value.siteName);
  const url = asNonEmptyString(value.url);
  if (!title || !siteName || !url) return null;
  return {
    description: asNonEmptyString(value.description),
    faviconUrl: asNonEmptyString(value.faviconUrl),
    imageUrl: asNonEmptyString(value.imageUrl),
    siteName,
    title,
    url,
  };
};

const getPreviewEndpoint = (url: string): string => {
  const path = `/api/link-preview?url=${encodeURIComponent(url)}`;
  return isNativePlatform() ? `${HOSTED_APP_ORIGIN}${path}` : path;
};

const getCachedPreview = (url: string): LinkPreview | null | undefined => {
  const entry = previewCache.get(url);
  if (!entry) return undefined;
  if (
    entry.preview === null &&
    Date.now() - entry.cachedAtMs >= NEGATIVE_PREVIEW_CACHE_TTL_MS
  ) {
    previewCache.delete(url);
    return undefined;
  }
  previewCache.delete(url);
  previewCache.set(url, entry);
  return entry.preview;
};

const cachePreview = (url: string, preview: LinkPreview | null) => {
  previewCache.delete(url);
  previewCache.set(url, { cachedAtMs: Date.now(), preview });
  while (previewCache.size > MAX_PREVIEW_CACHE_SIZE) {
    const oldestUrl = previewCache.keys().next().value;
    if (typeof oldestUrl !== "string") return;
    previewCache.delete(oldestUrl);
  }
};

const loadLinkPreview = (url: string): Promise<LinkPreview | null> => {
  const cached = getCachedPreview(url);
  if (cached !== undefined) return Promise.resolve(cached);
  const existing = previewRequests.get(url);
  if (existing) return existing;

  const request = fetch(getPreviewEndpoint(url), {
    headers: { Accept: "application/json" },
  })
    .then(async (response) => {
      if (!response.ok) return null;
      return parseLinkPreview(await response.json());
    })
    .catch(() => null)
    .then((preview) => {
      cachePreview(url, preview);
      previewRequests.delete(url);
      return preview;
    });
  previewRequests.set(url, request);
  return request;
};

export function LinkPreviewCard({ url }: LinkPreviewCardProps) {
  const cardRef = React.useRef<HTMLAnchorElement | null>(null);
  const [shouldLoad, setShouldLoad] = React.useState(
    getCachedPreview(url) !== undefined ||
      typeof IntersectionObserver === "undefined",
  );
  const [preview, setPreview] = React.useState<LinkPreview | null>(
    getCachedPreview(url) ?? null,
  );

  React.useEffect(() => {
    if (shouldLoad || typeof IntersectionObserver === "undefined") return;
    const element = cardRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setShouldLoad(true);
        observer.disconnect();
      },
      { rootMargin: "240px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [shouldLoad]);

  React.useEffect(() => {
    if (!shouldLoad) return;
    let active = true;
    void loadLinkPreview(url).then((nextPreview) => {
      if (active) setPreview(nextPreview);
    });
    return () => {
      active = false;
    };
  }, [shouldLoad, url]);

  if (!preview) {
    return shouldLoad ? null : (
      <a
        ref={cardRef}
        className="chat-link-preview chat-link-preview-placeholder"
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        aria-hidden="true"
        tabIndex={-1}
      />
    );
  }

  return (
    <a
      ref={cardRef}
      className="chat-link-preview"
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer"
    >
      {preview.imageUrl ? (
        <img
          className="chat-link-preview-image"
          src={preview.imageUrl}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      ) : null}
      <span className="chat-link-preview-body">
        <span className="chat-link-preview-site">
          {preview.faviconUrl ? (
            <img
              className="chat-link-preview-favicon"
              src={preview.faviconUrl}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          ) : null}
          {preview.siteName}
        </span>
        <strong className="chat-link-preview-title">{preview.title}</strong>
        {preview.description ? (
          <span className="chat-link-preview-description">
            {preview.description}
          </span>
        ) : null}
      </span>
    </a>
  );
}
