import { createIdFromString } from "@linky-fit/linksync";
import { OperationId, TransferCheckResult } from "@linky-fit/linkshu";
import { Either } from "effect";
import { act, useEffect } from "react";
import { expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import type { CheckCashuTransfer } from "../composition/useLinkshuComposition";
import { useCashuTokenChecks } from "./useCashuTokenChecks";

const tokenId = createIdFromString<"CashuOperation">("checked-token");

const checkTokenWithStatus = async (status: TransferCheckResult["status"]) => {
  const checkCashuTransfer = vi.fn<CheckCashuTransfer>(async () =>
    Either.right(
      new TransferCheckResult({
        operationId: OperationId.make("checked-token"),
        status,
      }),
    ),
  );
  const pushToast = vi.fn<(message: string) => void>();
  const setStatus = vi.fn();
  let checkToken = async () => {};
  const Harness = () => {
    const { checkAndRefreshCashuToken } = useCashuTokenChecks({
      cashuBulkCheckIsBusy: false,
      cashuIsBusy: false,
      checkAllCashuTokens: null,
      checkCashuTransfer,
      forgetCashuTransfer: null,
      pendingCashuDeleteId: null,
      pushToast,
      setCashuBulkCheckIsBusy: vi.fn(),
      setCashuIsBusy: vi.fn(),
      setPendingCashuDeleteId: vi.fn(),
      setStatus,
      t: (key) => key,
    });
    useEffect(() => {
      checkToken = async () => {
        await checkAndRefreshCashuToken(tokenId);
      };
    }, [checkAndRefreshCashuToken]);
    return null;
  };
  const { unmount } = await renderIntoDocument(<Harness />);
  await act(async () => checkToken());
  await unmount();
  const messages = [
    ...pushToast.mock.calls.map(([message]) => message),
    ...setStatus.mock.calls.map(([message]) => message),
  ];
  return messages;
};

it.each([
  ["live", "cashuCheckOk"],
  ["spent", "cashuInvalid"],
  ["unavailable", "cashuCheckFailed"],
] as const)("reports a %s token check exactly once", async (status, key) => {
  expect(await checkTokenWithStatus(status)).toEqual([key]);
});
