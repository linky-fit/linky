import type {
  ChannelSync,
  CompanySubscription,
  PrivateFeedSync,
  KeryxError,
  RefreshResult,
} from "@linky-fit/keryx";
import { Either } from "effect";
import { getInspectorEmissionEnabled } from "../../devtools/inspector/inspectorEnabled";
import type { InspectorRow } from "../../devtools/inspector/inspectorRows";
import { reportInspectorRows } from "../../devtools/inspector/reportInspectorRows";
import { privateFeedKey } from "./keryxCache";

export type KeryxRow = Omit<InspectorRow, "at" | "channel">;

const row = (
  tag: string,
  origin: string,
  summary: string,
  payload: unknown,
  links: InspectorRow["links"] = {},
): KeryxRow => ({
  tag,
  summary: `${origin}: ${summary}`,
  links: { company: origin, ...links },
  payload,
});

/** Swaps every capability URL for its key, so private feeds stay out of the log. */
const redacted = (value: unknown, feedUrls: ReadonlyArray<string>): unknown =>
  JSON.parse(
    feedUrls.reduce(
      (text, url) => text.split(url).join(privateFeedKey(url)),
      JSON.stringify(value) ?? "null",
    ),
  );

export const keryxPairedRow = (
  origin: string,
  channels: ReadonlyArray<string>,
  privateFeedCount: number,
): KeryxRow =>
  row(
    "keryx.paired",
    origin,
    `paired, ${channels.length} channels, ${privateFeedCount} private feeds`,
    { channels, privateFeedCount },
  );

export const keryxPairFailedRow = (
  origin: string,
  error: KeryxError | { readonly _tag: string },
): KeryxRow =>
  row("keryx.pairFailed", origin, `pairing failed: ${error._tag}`, error);

const verificationProblems = (
  result: RefreshResult,
): ReadonlyArray<ChannelSync | PrivateFeedSync> =>
  result._tag === "Refreshed"
    ? [
        ...result.channels.filter(
          (channel) =>
            channel.status === "unavailable" || channel.problems.length > 0,
        ),
        ...result.privateFeeds.filter(
          (feed) =>
            feed.status === "unavailable" ||
            feed.status === "unauthorized" ||
            feed.problems.length > 0,
        ),
      ]
    : [];

export const keryxRefreshRows = (
  subscription: CompanySubscription,
  outcome: Either.Either<RefreshResult, KeryxError>,
): ReadonlyArray<KeryxRow> => {
  const { origin } = subscription;
  const feedUrls = subscription.privateFeeds.map((feed) => feed.url);
  if (Either.isLeft(outcome)) {
    const error = redacted(outcome.left, feedUrls);
    const failed = row(
      "keryx.refreshFailed",
      origin,
      `refresh failed: ${outcome.left._tag}`,
      error,
    );
    return outcome.left._tag === "KeryxMetadataInvalid" ||
      outcome.left._tag === "KeryxRollbackDetected"
      ? [
          failed,
          row(
            "keryx.verificationFailed",
            origin,
            `metadata did not verify: ${outcome.left._tag}`,
            error,
          ),
        ]
      : [failed];
  }
  const result = outcome.right;
  switch (result._tag) {
    case "Suspended":
      return [
        row(
          "keryx.suspended",
          origin,
          `suspended: root ${result.rootVersion} does not chain to the pinned root`,
          result,
        ),
      ];
    case "Rebranded":
      return [
        row(
          "keryx.rebranded",
          origin,
          `rebranded from "${result.previousIdentity.companyName}" to "${result.identity.companyName}"`,
          result,
        ),
      ];
    case "Refreshed": {
      const problems = verificationProblems(result);
      const refreshed = row(
        "keryx.refreshed",
        origin,
        `${result.announcements.length} announcements, ${result.channels.length} channels, ${result.privateFeeds.length} private feeds`,
        redacted(
          {
            announcements: result.announcements.length,
            identityChange: result.identityChange,
            channels: result.channels,
            privateFeeds: result.privateFeeds,
          },
          feedUrls,
        ),
        { announcement: result.announcements.map((item) => item.id) },
      );
      return problems.length === 0
        ? [refreshed]
        : [
            refreshed,
            row(
              "keryx.verificationFailed",
              origin,
              `${problems.length} channels or private feeds had items or indexes that did not verify`,
              redacted(problems, feedUrls),
            ),
          ];
    }
  }
};

export const keryxUnpairedRow = (origin: string): KeryxRow =>
  row("keryx.unpaired", origin, "removed by the user", {});

export const keryxChannelsChangedRow = (
  origin: string,
  channels: ReadonlyArray<string>,
): KeryxRow =>
  row(
    "keryx.channelsChanged",
    origin,
    `following ${channels.join(", ") || "no channels"}`,
    { channels },
  );

export const keryxIdentityAcknowledgedRow = (
  origin: string,
  identity: unknown,
): KeryxRow =>
  row("keryx.identityAcknowledged", origin, "new logo acknowledged", {
    identity,
  });

export const keryxMediaFailedRow = (
  origin: string,
  url: string,
  reason: string,
  announcementId?: string,
): KeryxRow =>
  row(
    "keryx.mediaFailed",
    origin,
    `media did not verify: ${reason}`,
    { url, reason },
    announcementId === undefined ? {} : { announcement: announcementId },
  );

/** Builds the rows only while the inspector is on. */
export const reportKeryx = (build: () => ReadonlyArray<KeryxRow>): void => {
  if (!getInspectorEmissionEnabled()) return;
  const at = Date.now();
  reportInspectorRows(
    build().map((keryxRow) => ({
      ...keryxRow,
      at,
      channel: "keryx.operation",
    })),
  );
};
