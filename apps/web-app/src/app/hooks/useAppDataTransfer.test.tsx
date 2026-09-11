import { act, createRef, useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CashuTokenRow } from "../../evolu";
import { createCashuTokenRowFixture } from "../../testUtils/cashuTokenRow";
import { renderIntoDocument } from "../../testUtils/renderIntoDocument";
import { useAppDataTransfer } from "./useAppDataTransfer";

const mount = async (cashuTokens: readonly CashuTokenRow[] = []) => {
  const insert = vi.fn();
  const update = vi.fn();
  const pushToast = vi.fn();
  let transfer: ReturnType<typeof useAppDataTransfer> | undefined;
  const Harness = () => {
    const api = useAppDataTransfer({
      appOwnerId: null,
      cashuOperations: [],
      cashuProofs: [],
      cashuTokens,
      contacts: [],
      importCashuLegacyRows: null,
      importCashuOperation: null,
      importCashuProofs: null,
      importDataFileInputRef: createRef<HTMLInputElement>(),
      insert: () => {
        insert();
        throw new Error("Unexpected contact insert");
      },
      update: () => {
        update();
        throw new Error("Unexpected contact update");
      },
      pushToast,
      t: (key) => key,
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
  });

  it("exports the original identity of rewritten tokens in the legacy backup field", async () => {
    const { transfer } = await mount([
      createCashuTokenRowFixture({
        token: "cashuAcurrent",
        originalTokenText: "cashuAoriginal",
        rawToken: "cashuAlegacy",
      }),
      createCashuTokenRowFixture({
        token: "cashuAcurrent2",
        rawToken: "cashuAlegacy2",
      }),
    ]);
    const blobs: Blob[] = [];
    vi.stubGlobal("URL", {
      createObjectURL: (blob: Blob) => {
        blobs.push(blob);
        return "blob:backup";
      },
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    transfer.exportAppData();
    expect(blobs).toHaveLength(1);
    const reader = new FileReader();
    const text = new Promise<string>((resolve) => {
      reader.onload = () => resolve(String(reader.result));
    });
    reader.readAsText(blobs[0]);
    expect(JSON.parse(await text).cashuTokens).toEqual([
      expect.objectContaining({ rawToken: "cashuAoriginal" }),
      expect.objectContaining({ rawToken: "cashuAlegacy2" }),
    ]);
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
    expect(pushToast).toHaveBeenCalledWith("importWalletNotReady");
  });
});
