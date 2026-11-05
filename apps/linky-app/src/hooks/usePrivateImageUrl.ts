import React from "react";
import {
  decryptPrivateImageMessage,
  type PrivateImageSource,
} from "../app/lib/privateImageMessage";
import { useDivRef } from "./useDivRef";
import { useLatest } from "./useLatest";

/** An uploaded private image, or a picked file not uploaded yet. */
export type PrivateImageInput = PrivateImageSource | File;

export interface LoadedPrivateImage {
  readonly blob: Blob;
  readonly url: string;
}

const sourceKey = (source: PrivateImageInput): string =>
  source instanceof File
    ? `file:${source.name}:${source.size}:${source.lastModified}`
    : source.encryptedSha256;

/**
 * Decrypts `source` once the element behind `ref` comes near the viewport, as
 * an object URL revoked when the source changes or the component unmounts.
 */
export const usePrivateImageUrl = (source: PrivateImageInput) => {
  const elementRef = React.useRef<HTMLDivElement | null>(null);
  const [shouldLoad, setShouldLoad] = React.useState(
    typeof IntersectionObserver === "undefined",
  );
  const [loaded, setLoaded] = React.useState<LoadedPrivateImage | null>(null);
  const [failed, setFailed] = React.useState(false);
  const sourceRef = useLatest(source);
  const key = sourceKey(source);

  React.useEffect(() => {
    if (shouldLoad) return;
    const element = elementRef.current;
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
    let cancelled = false;
    let objectUrl: string | null = null;
    setLoaded(null);
    setFailed(false);
    const current = sourceRef.current;
    const blob =
      current instanceof File
        ? Promise.resolve(current)
        : decryptPrivateImageMessage(current);
    blob.then(
      (next) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(next);
        setLoaded({ blob: next, url: objectUrl });
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [key, shouldLoad, sourceRef]);

  return { ref: useDivRef(elementRef), shouldLoad, loaded, failed };
};
