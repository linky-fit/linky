import { Either } from "effect";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { MintUrl, TokenAlreadySpent } from "@linky/linkshu";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import type { Translate } from "../../../i18n";
import type { ReceiveCashuToken } from "../composition/useLinkshuComposition";
import { useSaveCashuFromText } from "./useSaveCashuFromText";

type SaveCashuFromText = ReturnType<typeof useSaveCashuFromText>;

const translateToKey: Translate = (key) => key;

const setup = async (
  receiveCashuToken: ReceiveCashuToken,
): Promise<SaveCashuFromText> => {
  const ref: { current: SaveCashuFromText | null } = { current: null };

  const Probe = (): null => {
    const save = useSaveCashuFromText({
      allowTestMints: true,
      enqueueCashuOp: async (op) => {
        await op();
      },
      formatDisplayedAmountParts: () => ({
        amountText: "0",
        approxPrefix: "",
        unitLabel: "sat",
      }),
      isCashuTokenStored: () => false,
      isMintDeleted: () => false,
      logPaymentEvent: vi.fn(),
      mintInfoByUrl: new Map(),
      receiveCashuToken,
      refreshMintInfo: async () => undefined,
      rememberCashuTokenKnown: vi.fn(),
      setCashuDraft: () => undefined,
      setCashuIsBusy: () => undefined,
      setStatus: () => undefined,
      showPaidOverlay: () => undefined,
      t: translateToKey,
      touchMintInfo: () => undefined,
    });
    React.useEffect(() => {
      ref.current = save;
    }, [save]);
    return null;
  };

  await renderIntoDocument(<Probe />);
  if (!ref.current) throw new Error("hook did not render");
  return ref.current;
};

describe("useSaveCashuFromText", () => {
  it("resolves terminally when the mint reports the token already spent", async () => {
    const save = await setup(async () =>
      Either.left(
        new TokenAlreadySpent({ mint: MintUrl.make("https://x.cz") }),
      ),
    );
    const onResolved = vi.fn();

    await save("cashuBspenttoken", { onResolved });

    // Lets the message-driven auto-accept stop retrying the dead token; its
    // in-session dedup resets on reload.
    expect(onResolved).toHaveBeenCalledWith("terminal");
  });

  it("resolves transiently on an unexpected receive failure", async () => {
    const save = await setup(async () => {
      throw new Error("mint unreachable");
    });
    const onResolved = vi.fn();

    await save("cashuBtransient", { onResolved });

    expect(onResolved).toHaveBeenCalledWith("transient");
  });
});
