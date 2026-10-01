import { Result, Schema } from "effect";
import { unwrapToRumor } from "../internal/giftWrap";
import { SignedWrapEvent, tagValues } from "../internal/nostrEvent";
import type { Rumor } from "../internal/nostrEvent";
import type { LinkstrIdentityService } from "../services/LinkstrIdentity";
import { WrapDropped } from "./events";

export interface AuthenticatedWrap {
  readonly wrap: SignedWrapEvent;
  readonly rumor: Rumor;
}

const decodeWrapResult = Schema.decodeUnknownResult(SignedWrapEvent);

/**
 * Vertical-neutral half of inbound processing: validate the outer wrap,
 * decrypt, and authenticate the rumor. Verticals dispatch on the result's
 * rumor kind without touching raw events again.
 */
export const authenticateWrap = (
  input: unknown,
  identity: LinkstrIdentityService,
): Result.Result<AuthenticatedWrap, WrapDropped> => {
  const decodedWrap = decodeWrapResult(input);
  if (Result.isFailure(decodedWrap)) {
    return Result.fail(
      new WrapDropped({ wrapId: null, reason: "malformed-wrap" }),
    );
  }
  const wrap = decodedWrap.success;

  if (!tagValues(wrap.tags, "p").includes(identity.pubkey)) {
    return Result.fail(
      new WrapDropped({ wrapId: wrap.id, reason: "not-addressed-to-me" }),
    );
  }

  return unwrapToRumor(wrap, identity.secretKey).pipe(
    Result.map((rumor) => ({ wrap, rumor })),
    Result.mapError((reason) => new WrapDropped({ wrapId: wrap.id, reason })),
  );
};
