import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Translate } from "../i18n";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";

const { mockNavigate, mockScanCore, mockScanActions } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockScanCore: vi.fn(),
  mockScanActions: vi.fn(),
}));

vi.mock("../hooks/useRouting", () => ({
  navigateTo: mockNavigate,
}));

import { ScanModal } from "./ScanModal";

vi.mock("../app/context/AppShellContexts", () => ({
  useAppShellCore: mockScanCore,
  useAppShellActions: mockScanActions,
}));

interface ScanModalProps {
  closeScan: () => void;
  cycleScanCamera: () => void;
  onIssueToken: () => void;
  onPickScanImage: () => void;
  onScanImageSelected: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onTypePayment: () => void;
  onTypeManually: () => void;
  pasteScanValue: () => Promise<void>;
  scanCameraLabel: string | null;
  scanCanSwitchCamera: boolean;
  scanEntryPoint: "contacts" | "receive" | "send" | null;
  scanImageInputRef: React.RefObject<HTMLInputElement | null>;
  scanVideoRef: React.RefObject<HTMLVideoElement | null>;
  showTypeAction: boolean;
  showWalletActions: boolean;
  t: Translate;
}

function TestScanModal(props: ScanModalProps) {
  mockScanCore.mockReturnValue({
    ...props,
    scanAllowsManualContact: props.showTypeAction,
  });
  mockScanActions.mockReturnValue({
    ...props,
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
    case "scan":
      return "Scan";
    case "scanTypeManually":
      return "Type";
    case "manualPayOpen":
      return "Type recipient";
    default:
      return key;
  }
};

describe("ScanModal", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    mockNavigate.mockReset();
  });

  const baseProps = {
    closeScan: () => {},
    cycleScanCamera: () => {},
    onIssueToken: () => {},
    onPickScanImage: () => {},
    onScanImageSelected: () => {},
    onTypePayment: () => {},
    onTypeManually: () => {},
    pasteScanValue: async () => {},
    scanCameraLabel: null,
    scanCanSwitchCamera: false,
    scanEntryPoint: null,
    scanImageInputRef: { current: null },
    scanVideoRef: { current: null },
    showTypeAction: false,
    showWalletActions: false,
    t: translate,
  } satisfies ScanModalProps;

  it("shows the manual action only when allowed", async () => {
    const { container, root } = await renderIntoDocument(
      <TestScanModal {...baseProps} showTypeAction={true} />,
    );

    expect(container.textContent).toContain("Type");
    expect(container.textContent).toContain("Paste");

    await act(async () => {
      root.render(<TestScanModal {...baseProps} showTypeAction={false} />);
    });

    expect(container.textContent).not.toContain("Type");
    expect(container.textContent).toContain("Paste");
  });

  it("offers camera switching when multiple cameras are available", async () => {
    const cycleScanCamera = vi.fn();

    const { container } = await renderIntoDocument(
      <TestScanModal
        {...baseProps}
        cycleScanCamera={cycleScanCamera}
        scanCameraLabel="Back Camera 2"
        scanCanSwitchCamera={true}
      />,
    );

    const button = container.querySelector(".scan-camera-switch");
    expect(button?.getAttribute("title")).toBe("Back Camera 2");

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(cycleScanCamera).toHaveBeenCalledTimes(1);
  });

  it("calls the manual handler when the type button is pressed", async () => {
    const onTypeManually = vi.fn();

    const { container } = await renderIntoDocument(
      <TestScanModal
        {...baseProps}
        onTypeManually={onTypeManually}
        showTypeAction={true}
      />,
    );

    const button = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("Type"),
    );

    expect(button).toBeTruthy();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onTypeManually).toHaveBeenCalledTimes(1);
  });

  it("returns receive scan close to wallet", async () => {
    const closeScan = vi.fn();

    const { container } = await renderIntoDocument(
      <TestScanModal
        {...baseProps}
        closeScan={closeScan}
        scanEntryPoint="receive"
      />,
    );

    const button = container.querySelector(".scan-header .topbar-btn");

    expect(button).toBeTruthy();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(closeScan).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith({ route: "wallet" });
  });

  it("shows issue action in send flow and calls it", async () => {
    const onIssueToken = vi.fn();

    const { container } = await renderIntoDocument(
      <TestScanModal
        {...baseProps}
        onIssueToken={onIssueToken}
        scanEntryPoint="send"
        showWalletActions={true}
      />,
    );

    const button = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("Issue"),
    );

    expect(container.querySelector(".scan-sheet--send")).toBeTruthy();
    expect(button).toBeTruthy();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onIssueToken).toHaveBeenCalledTimes(1);
  });

  it("shows manual recipient action in send flow and calls it", async () => {
    const onTypePayment = vi.fn();

    const { container } = await renderIntoDocument(
      <TestScanModal
        {...baseProps}
        onTypePayment={onTypePayment}
        scanEntryPoint="send"
        showWalletActions={true}
      />,
    );

    const button = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("Type recipient"),
    );

    expect(button).toBeTruthy();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onTypePayment).toHaveBeenCalledTimes(1);
  });
});
