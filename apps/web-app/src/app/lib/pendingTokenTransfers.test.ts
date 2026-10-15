import { describe, expect, it } from "vitest";
import {
  buildCashuToken,
  reencodeCashuToken,
} from "../../testUtils/cashuToken";
import type { LocalNostrMessage } from "../types/appTypes";
import { tokenChatMessages } from "./pendingTokenTransfers";

const message = (id: string, content: string): LocalNostrMessage => ({
  id,
  contactId: id,
  content,
  createdAtSec: 1,
  direction: "out",
  pubkey: "",
  rumorId: null,
  wrapId: "",
});

describe("tokenChatMessages", () => {
  it("links a v4 send to the chat message carrying its proofs as a NUT-18 payload", () => {
    const { payload, v4 } = reencodeCashuToken(buildCashuToken());
    const paid = message("paid", payload);

    const chatsForToken = tokenChatMessages([
      paid,
      message("other", buildCashuToken({ secretPrefix: "other" })),
    ]);

    expect(chatsForToken(v4)).toEqual([paid]);
    expect(chatsForToken("not a token")).toEqual([]);
  });
});
