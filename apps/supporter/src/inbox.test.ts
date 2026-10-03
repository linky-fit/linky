import {
  ChatMessageReceived,
  CashuTokenText,
  PaymentNoticeReceived,
  TextBody,
  TokenBody,
  UnixSeconds,
} from "@linky-fit/linkstr";
import type { MessageBody, Pubkey } from "@linky-fit/linkstr";
import { beforeEach, describe, expect, it, spyOn } from "bun:test";
import { createInboxHandler } from "./inbox";
import type { TokenMessage } from "./pipeline";
import { SupporterStorage } from "./storage";
import { testPubkey, testRumorId, tokenText } from "./testSupport";

const OCT_3 = UnixSeconds.make(Date.UTC(2026, 9, 3, 12) / 1000);

const message = (
  body: MessageBody,
  options: { from?: Pubkey; sentAt?: UnixSeconds; edit?: boolean } = {},
) =>
  new ChatMessageReceived({
    messageId: testRumorId("1"),
    from: options.from ?? testPubkey(1),
    body,
    replyTo: null,
    root: null,
    editOf: options.edit === true ? testRumorId("2") : null,
    clientId: null,
    sentAt: options.sentAt ?? OCT_3,
  });

const text = (content: string) => new TextBody({ text: content });

const setup = () => {
  const storage = new SupporterStorage(":memory:");
  const tokens: TokenMessage[] = [];
  const replies: Array<[Pubkey, string]> = [];
  const handle = createInboxHandler({
    handleToken: (token) => {
      tokens.push(token);
      return Promise.resolve();
    },
    claimAutoReply: (sender, day) => storage.claimAutoReply(sender, day),
    sendAutoReply: (to, day) => {
      replies.push([to, day]);
      return Promise.resolve();
    },
  });
  return { handle, tokens, replies };
};

beforeEach(() => {
  spyOn(console, "info").mockImplementation(() => {});
});

describe("inbox handler", () => {
  it("hands token messages to the payment pipeline", async () => {
    const { handle, tokens, replies } = setup();
    const token = CashuTokenText.make(tokenText(5_000));
    await handle(message(new TokenBody({ token })));
    expect(tokens).toEqual([
      { from: testPubkey(1), rumorId: testRumorId("1"), token },
    ]);
    expect(replies).toEqual([]);
  });

  it("auto-replies once per sender and day, replays included", async () => {
    const { handle, replies } = setup();
    await handle(message(text("hi")));
    await handle(message(text("hello again")));
    await handle(message(text("hi"), { from: testPubkey(2) }));
    await handle(
      message(text("next day"), {
        sentAt: UnixSeconds.make(OCT_3 + 24 * 60 * 60),
      }),
    );
    expect(replies).toEqual([
      [testPubkey(1), "2026-10-03"],
      [testPubkey(2), "2026-10-03"],
      [testPubkey(1), "2026-10-04"],
    ]);
  });

  it("ignores edits and payment notices", async () => {
    const { handle, tokens, replies } = setup();
    await handle(message(text("edited"), { edit: true }));
    await handle(
      new PaymentNoticeReceived({
        noticeId: testRumorId("3"),
        from: testPubkey(1),
        context: null,
        offerId: null,
        sentAt: OCT_3,
      }),
    );
    expect(tokens).toEqual([]);
    expect(replies).toEqual([]);
  });
});
