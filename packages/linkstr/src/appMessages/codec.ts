import { Either, Schema } from "effect";
import { isClientId, isRumorId } from "../domain/primitives";
import type { ClientId, Pubkey, UnixSeconds } from "../domain/primitives";
import type { DropReason } from "../inbox/events";
import {
  firstTagValue,
  Rumor,
  rumorWithHash,
  tagValues,
} from "../internal/nostrEvent";
import type { LinkstrIdentityService } from "../services/LinkstrIdentity";
import { AppNamespace } from "./domain";
import type { AppMessageDraft } from "./domain";
import { AppMessageReceived } from "./events";
import type { AppMessageInboxEvent } from "./events";

export const APP_MESSAGE_KIND = 24137;
export const APP_MESSAGE_VALUE = "app_message";

const isAppNamespace = Schema.is(AppNamespace);

export const encodeAppMessageRumor = (
  draft: AppMessageDraft,
  author: Pubkey,
  sentAt: UnixSeconds,
  clientId: ClientId,
): Rumor =>
  rumorWithHash({
    pubkey: author,
    created_at: sentAt,
    kind: APP_MESSAGE_KIND,
    tags: [
      ["p", draft.to],
      ["p", author],
      ["client", clientId],
      ["linky", APP_MESSAGE_VALUE],
      ["app", draft.app],
    ],
    content: draft.content,
  });

export const decodeAppMessageRumor = (
  rumor: Rumor,
  identity: LinkstrIdentityService,
): Either.Either<AppMessageInboxEvent, DropReason> => {
  const app = firstTagValue(rumor.tags, "app");
  const clientId = firstTagValue(rumor.tags, "client");
  if (
    rumor.kind !== APP_MESSAGE_KIND ||
    !rumor.tags.some(
      (tag) => tag[0] === "linky" && tag[1] === APP_MESSAGE_VALUE,
    ) ||
    app === null ||
    !isAppNamespace(app) ||
    rumor.pubkey === identity.pubkey ||
    !tagValues(rumor.tags, "p").includes(identity.pubkey) ||
    !isRumorId(rumor.id)
  ) {
    return Either.left("invalid-app-message");
  }
  return Either.right(
    new AppMessageReceived({
      messageId: rumor.id,
      from: rumor.pubkey,
      app,
      content: rumor.content,
      clientId: clientId !== null && isClientId(clientId) ? clientId : null,
      sentAt: rumor.created_at,
    }),
  );
};
