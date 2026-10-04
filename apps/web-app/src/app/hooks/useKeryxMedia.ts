import { fetchVerifiedMedia, type Attachment } from "@linky-fit/keryx";
import { base64 } from "@scure/base";
import { Effect, Either } from "effect";
import React from "react";
import { saveFile } from "../../platform/fileExport";
import { keryxMediaFailedRow, reportKeryx } from "../lib/keryxInspector";

export interface KeryxMedia {
  readonly origin: string;
  readonly url: string | undefined;
  readonly sha256: string | undefined;
  readonly announcementId?: string;
}

const verifiedBytes = async (
  media: KeryxMedia & { readonly url: string; readonly sha256: string },
): Promise<Uint8Array<ArrayBuffer> | null> => {
  const result = await Effect.runPromise(
    Effect.either(
      fetchVerifiedMedia({
        url: media.url,
        sha256: media.sha256,
        fetch: globalThis.fetch,
      }),
    ),
  );
  if (Either.isRight(result)) return new Uint8Array(result.right);
  reportKeryx(() => [
    keryxMediaFailedRow(
      media.origin,
      media.url,
      result.left.reason,
      media.announcementId,
    ),
  ]);
  return null;
};

// Never blob: URLs, which a new tab renders as a document with Linky's origin;
// raster decoders ignore the declared type, SVG alone needs its own.
const displayUrlOf = (url: string, bytes: Uint8Array): string => {
  const type = new URL(url).pathname.toLowerCase().endsWith(".svg")
    ? "image/svg+xml"
    : "image/png";
  return `data:${type};base64,${base64.encode(bytes)}`;
};

// Verified media stays as display URLs for the session; one per pinned hash.
const displayUrls = new Map<string, Promise<string | null>>();

const verifiedDisplayUrl = (
  media: KeryxMedia & { readonly url: string; readonly sha256: string },
): Promise<string | null> => {
  const cached = displayUrls.get(media.sha256);
  if (cached) return cached;
  const created = verifiedBytes(media).then((bytes) =>
    bytes === null ? null : displayUrlOf(media.url, bytes),
  );
  displayUrls.set(media.sha256, created);
  void created.then((url) => {
    if (url === null) displayUrls.delete(media.sha256);
  });
  return created;
};

/**
 * A displayable URL for a logo or image: inline data URLs as they are, linked
 * media only after its bytes matched the pinned SHA-256, never unverified.
 */
export const useKeryxMediaUrl = (media: KeryxMedia): string | undefined => {
  const { origin, url, sha256, announcementId } = media;
  const inline = url?.startsWith("data:") ? url : undefined;
  const [verified, setVerified] = React.useState<{
    readonly key: string;
    readonly url: string | null;
  }>();
  React.useEffect(() => {
    if (inline !== undefined || url === undefined || sha256 === undefined) {
      return;
    }
    let active = true;
    void verifiedDisplayUrl({
      origin,
      url,
      sha256,
      ...(announcementId === undefined ? {} : { announcementId }),
    }).then((displayUrl) => {
      if (active) setVerified({ key: sha256, url: displayUrl });
    });
    return () => {
      active = false;
    };
  }, [announcementId, inline, origin, sha256, url]);
  if (inline !== undefined) return inline;
  return verified && verified.key === sha256
    ? (verified.url ?? undefined)
    : undefined;
};

const fileNameOf = (attachment: Attachment): string =>
  attachment.name ??
  new URL(attachment.url).pathname.split("/").pop() ??
  "attachment";

/**
 * Opens an attachment: one pinned by a hash is saved only once its bytes
 * match; one without a hash is an ordinary web link. Resolves false when the
 * bytes did not verify.
 */
export const openKeryxAttachment = async (
  origin: string,
  attachment: Attachment,
  announcementId: string,
): Promise<boolean> => {
  if (attachment.sha256 === undefined) {
    window.open(attachment.url, "_blank", "noopener,noreferrer");
    return true;
  }
  const bytes = await verifiedBytes({
    origin,
    url: attachment.url,
    sha256: attachment.sha256,
    announcementId,
  });
  if (bytes === null) return false;
  const fileName = fileNameOf(attachment);
  await saveFile({
    blob: new Blob([bytes], {
      type: attachment.mimeType ?? "application/octet-stream",
    }),
    fileName,
    title: fileName,
  }).catch(() => undefined);
  return true;
};
