import type {
  CompanySnapshot,
  JoinRequest,
  KeryxError,
  KeryxJoinError,
  KeryxJoinUrlInvalid,
} from "@linky-fit/keryx";
import type { I18nKey } from "../../i18n";

export const joinErrorKey = (error: KeryxJoinError): I18nKey =>
  error._tag === "KeryxJoinVersionUnsupported"
    ? "keryxJoinVersionUnsupported"
    : "keryxJoinUrlInvalid";

export const pairErrorKey = (
  error: KeryxError | KeryxJoinUrlInvalid,
): I18nKey =>
  error._tag === "KeryxLiteModeUnsupported"
    ? "keryxLiteModeUnsupported"
    : "keryxPairFailed";

/** The suggested channels the company actually publishes, preselected for consent. */
export const suggestedChannels = (
  request: JoinRequest,
  snapshot: CompanySnapshot,
): ReadonlySet<string> =>
  new Set(
    request.channels.filter((name) =>
      snapshot.catalog.some((channel) => channel.name === name),
    ),
  );
