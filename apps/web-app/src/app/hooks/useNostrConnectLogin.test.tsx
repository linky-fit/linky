import {
  NostrConnectLoginReceipt,
  NostrConnectRequestRefused,
  NostrConnectTimedOut,
  parseNostrConnectUri,
  type NostrConnectRequest,
} from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { Exit } from "effect";
import { act, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../testUtils/renderIntoDocument";

const { logInMock } = vi.hoisted(() => ({
  logInMock:
    vi.fn<
      (
        request: NostrConnectRequest,
      ) => Promise<Exit.Exit<NostrConnectLoginReceipt, { _tag: string }>>
    >(),
}));

vi.mock("@linky-fit/linkstr-react", () => ({
  nostrConnectLoginAtom: "nostrConnectLogin",
  useAtomSet: () => logInMock,
}));

import {
  useNostrConnectLogin,
  type NostrConnectLoginResult,
} from "./useNostrConnectLogin";

const parsed = parseNostrConnectUri(
  `nostrconnect://${makeIdentity().pubkey}?relay=wss%3A%2F%2Frelay.example.com&secret=s3cr3t&name=Example`,
);
if (!parsed) throw new Error("fixture URI did not parse");
const REQUEST: NostrConnectRequest = parsed;

const t = (key: string) => key;

describe("useNostrConnectLogin", () => {
  const latest: { current: NostrConnectLoginResult | null } = {
    current: null,
  };
  const setStatus = vi.fn();

  function Harness(): null {
    const result = useNostrConnectLogin({ setStatus, t });
    useEffect(() => {
      latest.current = result;
    });
    return null;
  }

  const confirm = async () => {
    await act(async () => {
      latest.current?.requestNostrConnectLoginConfirmation(REQUEST);
    });
    await act(async () => {
      await latest.current?.confirmNostrConnectLogin();
    });
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    latest.current = null;
  });

  it("keeps the dialog in its done state instead of a toast and closes it on a timer", async () => {
    logInMock.mockResolvedValue(
      Exit.succeed(
        new NostrConnectLoginReceipt({
          clientPubkey: REQUEST.clientPubkey,
          signedKind: 22242,
          authorizedDevice: null,
        }),
      ),
    );
    const rendered = await renderIntoDocument(<Harness />);

    await confirm();

    expect(logInMock).toHaveBeenCalledExactlyOnceWith(REQUEST);
    expect(latest.current?.pendingNostrConnectLoginConfirmation).toBe(REQUEST);
    expect(latest.current?.nostrConnectLoginIsDone).toBe(true);
    expect(latest.current?.nostrConnectLoginIsBusy).toBe(false);
    expect(setStatus).not.toHaveBeenCalled();

    await act(async () => {
      latest.current?.closeNostrConnectLoginConfirmation();
    });
    expect(latest.current?.pendingNostrConnectLoginConfirmation).toBe(REQUEST);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2400);
    });
    expect(latest.current?.nostrConnectLoginIsDone).toBe(false);
    expect(latest.current?.pendingNostrConnectLoginConfirmation).toBeNull();

    await rendered.unmount();
  });

  it.each([
    [new NostrConnectTimedOut(), "nostrConnectLoginTimedOut"],
    [
      new NostrConnectRequestRefused({
        method: "sign_event",
        reason: "kind 1 is not a login",
      }),
      "nostrConnectLoginRefused",
    ],
    [{ _tag: "LinkstrNotConfigured" }, "nostrConnectLoginUnavailable"],
    [{ _tag: "SomethingNew" }, "nostrConnectLoginFailed"],
  ])(
    "reports %o through the status toast and keeps the dialog",
    async (error, key) => {
      logInMock.mockResolvedValue(Exit.fail(error));
      const rendered = await renderIntoDocument(<Harness />);

      await confirm();

      expect(latest.current?.nostrConnectLoginIsDone).toBe(false);
      expect(latest.current?.nostrConnectLoginIsBusy).toBe(false);
      expect(latest.current?.pendingNostrConnectLoginConfirmation).toBe(
        REQUEST,
      );
      expect(setStatus).toHaveBeenCalledWith(`errorPrefix: ${key}`);

      await rendered.unmount();
    },
  );

  it("closes a request the user cancels without contacting the site", async () => {
    const rendered = await renderIntoDocument(<Harness />);

    await act(async () => {
      latest.current?.requestNostrConnectLoginConfirmation(REQUEST);
    });
    await act(async () => {
      latest.current?.closeNostrConnectLoginConfirmation();
    });

    expect(latest.current?.pendingNostrConnectLoginConfirmation).toBeNull();
    expect(logInMock).not.toHaveBeenCalled();

    await rendered.unmount();
  });
});
