import {
  Amount,
  CurrencyUnit,
  MintUrl,
  NewOperation,
  OperationId,
  TokenText,
  UnixSeconds,
} from "@linky-fit/linkshu";
import { Schema } from "effect";
import { act, createRef, useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { en } from "../../i18n/en";
import { renderIntoDocument } from "../../testUtils/renderIntoDocument";
import { useAppDataTransfer } from "./useAppDataTransfer";

const mocks = vi.hoisted(() => ({
  saveFile: vi.fn<(file: { fileName: string }) => Promise<void>>(
    async () => undefined,
  ),
}));

vi.mock("../../platform/fileExport", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../platform/fileExport")>();
  return { ...actual, saveFile: mocks.saveFile };
});

type WalletImports = Pick<
  Parameters<typeof useAppDataTransfer>[0],
  "importCashuLegacyRows" | "importCashuOperation" | "importCashuProofs"
>;

const walletUnavailable: WalletImports = {
  importCashuLegacyRows: null,
  importCashuOperation: null,
  importCashuProofs: null,
};

const mount = async (wallet: WalletImports = walletUnavailable) => {
  const insert = vi.fn();
  const update = vi.fn();
  const pushToast = vi.fn();
  let transfer: ReturnType<typeof useAppDataTransfer> | undefined;
  const Harness = () => {
    const api = useAppDataTransfer({
      cashuOperations: [],
      cashuProofs: [],
      contacts: [],
      contactsRepository: {
        insert: () => {
          insert();
          throw new Error("Unexpected contact insert");
        },
        update: () => {
          update();
          throw new Error("Unexpected contact update");
        },
      },
      ...wallet,
      importDataFileInputRef: createRef<HTMLInputElement>(),
      pushToast,
      t: (key) => en[key],
    });
    useEffect(() => {
      transfer = api;
    }, [api]);
    return null;
  };
  await renderIntoDocument(<Harness />);
  if (!transfer) throw new Error("Transfer hook did not mount");
  return { transfer, insert, update, pushToast };
};

describe("useAppDataTransfer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    mocks.saveFile.mockReset();
    mocks.saveFile.mockResolvedValue(undefined);
  });

  it("hands the export file to the platform and confirms with a toast", async () => {
    const { transfer, pushToast } = await mount();
    await act(() => {
      transfer.exportAppData();
    });
    const file = mocks.saveFile.mock.calls[0]?.[0];
    expect(file?.fileName).toMatch(/^linky-export-\d{4}-\d{2}-\d{2}\.txt$/);
    expect(pushToast).toHaveBeenCalledWith(en.exportDone);
  });

  it("stays quiet when the native share sheet is dismissed", async () => {
    mocks.saveFile.mockRejectedValueOnce(new Error("Share canceled"));
    const { transfer, pushToast } = await mount();
    await act(() => {
      transfer.exportAppData();
    });
    expect(pushToast).not.toHaveBeenCalled();
  });

  it("reports a failed export", async () => {
    mocks.saveFile.mockRejectedValueOnce(new Error("disk full"));
    const { transfer, pushToast } = await mount();
    await act(() => {
      transfer.exportAppData();
    });
    expect(pushToast).toHaveBeenCalledWith(en.exportFailed);
  });

  it("rejects a backup containing wallet rows before writing contacts when the wallet is unavailable", async () => {
    const { transfer, insert, update, pushToast } = await mount();
    const file = Object.assign(new File([], "backup.txt"), {
      text: async () =>
        JSON.stringify({
          contacts: [{ name: "Alice" }],
          cashuTokens: [{ token: "cashuAbackup" }],
        }),
    });
    await act(() => transfer.handleImportAppDataFilePicked(file));
    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith(en.importWalletNotReady);
  });

  it("counts the operations of a backup that holds only a deferred receive", async () => {
    const importCashuOperation = vi.fn(async () =>
      OperationId.make("AQEBAQEBAQEBAQEBAQEBAQ"),
    );
    const { transfer, pushToast } = await mount({
      importCashuLegacyRows: async () => {
        throw new Error("Unexpected legacy rows");
      },
      importCashuOperation,
      importCashuProofs: async () => {
        throw new Error("Unexpected proofs");
      },
    });
    const deferral = Schema.encodeSync(NewOperation)(
      new NewOperation({
        kind: "deferredReceive",
        status: "pending",
        mint: MintUrl.make("https://mint.example"),
        unit: CurrencyUnit.make("sat"),
        keysetId: null,
        amount: Amount.make(21),
        feeReserve: null,
        inputsTotal: null,
        quoteId: null,
        invoice: null,
        sourceMint: null,
        counter: null,
        locked: null,
        expiresAt: null,
        createdAt: UnixSeconds.make(1_700_000_000),
        tokenText: TokenText.make("cashuBpending"),
        error: null,
      }),
    );
    const file = Object.assign(new File([], "backup.txt"), {
      text: async () => JSON.stringify({ cashuOperations: [deferral] }),
    });

    await act(() => transfer.handleImportAppDataFilePicked(file));

    expect(importCashuOperation).toHaveBeenCalledOnce();
    expect(pushToast).toHaveBeenCalledWith(
      "Import complete. Contacts added: 0, updated: 0, proofs: 0, wallet operations: 1.",
    );
  });
});
