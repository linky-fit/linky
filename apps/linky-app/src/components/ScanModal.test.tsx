import { AtomRegistry, RegistryContext } from "@linky-fit/linkstr-react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Translate } from "../i18n";
import { localOverlayDismissStackAtom } from "../app/state/shell/overlays";
import type { ScanDiagnostics } from "../app/state/shell/scan";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";

const {
  mockNavigate,
  mockScanView,
  mockScanCommands,
  mockScanShortcuts,
  mockSetScanPaused,
} = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockScanView: vi.fn(),
  mockScanCommands: vi.fn(),
  mockScanShortcuts: vi.fn(),
  mockSetScanPaused: vi.fn(),
}));

vi.mock("../hooks/useRouting", () => ({
  navigateTo: mockNavigate,
}));

import { ScanModal } from "./ScanModal";

vi.mock("../app/hooks/shell/scan", () => ({
  useScanCommands: mockScanCommands,
  useScanShortcuts: mockScanShortcuts,
  useScanView: mockScanView,
  useSetScanPaused: () => mockSetScanPaused,
}));

vi.mock("../app/hooks/shell", async () =>
  (await import("../testUtils/shellHooks")).shellHooksMock({
    t: (key) => translate(key),
  }),
);

interface ScanModalProps {
  closeScan: () => void;
  cycleScanCamera: () => void;
  onIssueToken: () => void;
  onPickScanImage: () => void;
  onTypePayment: () => void;
  onTypeManually: () => void;
  pasteScanValue: () => Promise<void>;
  scanDiagnostics: ScanDiagnostics;
  scanCanSwitchCamera: boolean;
  scanEntryPoint: "contacts" | "receive" | "send" | null;
  scanVideoRef: React.RefObject<HTMLVideoElement | null>;
  showTypeAction: boolean;
  showWalletActions: boolean;
  t: Translate;
}

function TestScanModal(props: ScanModalProps) {
  mockScanView.mockReturnValue({
    ...props,
    scanAllowsManualContact: props.showTypeAction,
  });
  mockScanCommands.mockReturnValue(props);
  mockScanShortcuts.mockReturnValue({
    openIssueTokenFromScan: props.onIssueToken,
    openManualPayFromScan: props.onTypePayment,
    openManualContactFromScan: props.onTypeManually,
  });
  return <ScanModal />;
}

const translate = (key: string): string => {
  switch (key) {
    case "cashuEmit":
      return "Issue";
    case "close":
      return "Close";
    case "paste":
      return "Paste";
    case "scanAnimatedQrProgress":
      return "Reading QR: {received}/{expected} ({percent}%)";
    case "scan":
      return "Scan";
    case "scanTypeManually":
      return "Type";
    case "scanMoreOptions":
      return "More";
    case "manualPayOpen":
      return "Type recipient";
    default:
      return key;
  }
};

const buttonNamed = (name: string): HTMLElement | undefined =>
  Array.from(document.querySelectorAll<HTMLElement>("button")).find(
    (element) =>
      (element.getAttribute("aria-label") ?? element.textContent) === name,
  );

const press = async (element: HTMLElement | undefined) => {
  expect(element).toBeTruthy();
  await act(async () => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

describe("ScanModal", () => {
  afterEach(() => {
    mockNavigate.mockReset();
    mockSetScanPaused.mockReset();
  });

  const baseProps = {
    closeScan: () => {},
    cycleScanCamera: () => {},
    onIssueToken: () => {},
    onPickScanImage: () => {},
    onTypePayment: () => {},
    onTypeManually: () => {},
    pasteScanValue: async () => {},
    scanDiagnostics: {
      animation: null,
      lastRejection: "",
      lastValue: "",
      reads: 0,
    },
    scanCanSwitchCamera: false,
    scanEntryPoint: null,
    scanVideoRef: { current: null },
    showTypeAction: false,
    showWalletActions: false,
    t: translate,
  } satisfies ScanModalProps;

  it("is a dialog named by its title", async () => {
    await renderIntoDocument(
      <TestScanModal {...baseProps} scanEntryPoint="contacts" />,
    );

    const labelId = document
      .querySelector('[role="dialog"]')
      ?.getAttribute("aria-labelledby");
    expect(labelId && document.getElementById(labelId)?.textContent).toBe(
      "contactsScanContactQr",
    );
  });

  it("shows animated QR progress in the footer outside the camera preview", async () => {
    const { rerender, unmount } = await renderIntoDocument(
      <TestScanModal {...baseProps} scanEntryPoint="receive" />,
    );
    expect(document.querySelector('[role="status"]')).toBeNull();

    await rerender(
      <TestScanModal
        {...baseProps}
        scanEntryPoint="receive"
        scanDiagnostics={{
          ...baseProps.scanDiagnostics,
          animation: { expected: 10, received: 4 },
          reads: 4,
        }}
      />,
    );

    const status = document.querySelector(
      '[data-scan-region="footer"] [role="status"]',
    );
    expect(status?.textContent).toContain("Reading QR: 4/10 (40%)");
    expect(
      status
        ?.querySelector('[role="progressbar"]')
        ?.getAttribute("aria-valuenow"),
    ).toBe("0.4");
    expect(status?.textContent).not.toContain("scanDiagnosticsReads");
    await unmount();
  });

  it("shows the manual action only when allowed", async () => {
    const { rerender } = await renderIntoDocument(
      <TestScanModal {...baseProps} showTypeAction={true} />,
    );

    expect(buttonNamed("Type")).toBeTruthy();
    expect(buttonNamed("Paste")).toBeTruthy();

    await rerender(<TestScanModal {...baseProps} showTypeAction={false} />);

    expect(buttonNamed("Type")).toBeUndefined();
    expect(buttonNamed("Paste")).toBeTruthy();
  });

  it("offers camera switching when multiple cameras are available", async () => {
    const cycleScanCamera = vi.fn();

    await renderIntoDocument(
      <TestScanModal
        {...baseProps}
        cycleScanCamera={cycleScanCamera}
        scanCanSwitchCamera={true}
      />,
    );

    await press(buttonNamed("scanSwitchCamera"));

    expect(cycleScanCamera).toHaveBeenCalledTimes(1);
  });

  it("calls the manual handler when the type button is pressed", async () => {
    const onTypeManually = vi.fn();

    await renderIntoDocument(
      <TestScanModal
        {...baseProps}
        onTypeManually={onTypeManually}
        showTypeAction={true}
      />,
    );

    await press(buttonNamed("Type"));

    expect(onTypeManually).toHaveBeenCalledTimes(1);
  });

  it("dismisses receive scan without navigating away from the receive page", async () => {
    const closeScan = vi.fn();

    await renderIntoDocument(
      <TestScanModal
        {...baseProps}
        closeScan={closeScan}
        scanEntryPoint="receive"
      />,
    );

    await press(buttonNamed("Close"));

    expect(closeScan).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("shows issue action under More in send flow and calls it", async () => {
    const onIssueToken = vi.fn();

    await renderIntoDocument(
      <TestScanModal
        {...baseProps}
        onIssueToken={onIssueToken}
        scanEntryPoint="send"
        showWalletActions={true}
      />,
    );

    expect(buttonNamed("Issue")).toBeUndefined();
    await press(buttonNamed("More"));
    await press(buttonNamed("Issue"));

    expect(onIssueToken).toHaveBeenCalledTimes(1);
  });

  it("shows manual recipient action under More in send flow and calls it", async () => {
    const onTypePayment = vi.fn();

    await renderIntoDocument(
      <TestScanModal
        {...baseProps}
        onTypePayment={onTypePayment}
        scanEntryPoint="send"
        showWalletActions={true}
      />,
    );

    expect(buttonNamed("Type recipient")).toBeUndefined();
    await press(buttonNamed("More"));
    await press(buttonNamed("Type recipient"));

    expect(onTypePayment).toHaveBeenCalledTimes(1);
  });

  it("pauses scanning, registers Android back dismiss, and restores focus to More when dismissed", async () => {
    const registry = AtomRegistry.make();
    const closeScan = vi.fn();

    await renderIntoDocument(
      <RegistryContext.Provider value={registry}>
        <TestScanModal
          {...baseProps}
          closeScan={closeScan}
          scanEntryPoint="send"
          showWalletActions={true}
        />
      </RegistryContext.Provider>,
    );

    const more = buttonNamed("More");
    more?.focus();
    await press(more);

    expect(mockSetScanPaused).toHaveBeenCalledWith(true);
    const dismiss = registry.get(localOverlayDismissStackAtom).at(-1)?.dismiss;
    expect(dismiss).toBeDefined();

    await act(async () => {
      dismiss?.();
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 500)));

    expect(mockSetScanPaused).toHaveBeenLastCalledWith(false);
    expect(closeScan).not.toHaveBeenCalled();
    expect(buttonNamed("Issue")).toBeUndefined();
    expect(document.activeElement).toBe(more);
  });
});
