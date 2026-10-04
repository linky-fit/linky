import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { PasswordManagerSaveResult } from "../platform/passwordManager";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { MasterKeysPage } from "./MasterKeysPage";

const { pushToast, saveSeedToPasswordManager } = vi.hoisted(() => ({
  pushToast: vi.fn(),
  saveSeedToPasswordManager: vi.fn(),
}));

vi.mock("../app/context/AppShellContexts", () => ({
  useAppShellCore: () => ({ t: (key: string) => key }),
}));

vi.mock("../app/context/SystemSettingsContexts", () => ({
  useAdvancedSettingsContext: () => ({
    copySeed: vi.fn(),
    pushToast,
    saveSeedToPasswordManager,
    seedMnemonic: "academic acid acne",
  }),
}));

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

it.each<[PasswordManagerSaveResult, string]>([
  ["saved", "onboardingBackupSaveRequested"],
  ["failed", "onboardingBackupSaveFailed"],
  ["unsupported", "onboardingBackupSaveUnavailable"],
])("reports a %s password manager save", async (result, toast) => {
  saveSeedToPasswordManager.mockResolvedValue(result);
  const { container, unmount } = await renderIntoDocument(<MasterKeysPage />);
  const saveButton = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "onboardingBackupSave",
  );
  if (!saveButton) throw new Error("save button missing");

  await act(async () => saveButton.click());

  expect(pushToast).toHaveBeenCalledExactlyOnceWith(toast);
  await unmount();
});
