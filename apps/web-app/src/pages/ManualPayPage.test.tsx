import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createId } from "@linky-fit/linksync";
import { navigateTo } from "../hooks/useRouting";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { ManualPayPage } from "./ManualPayPage";

vi.mock("../hooks/useRouting", () => ({
  navigateTo: vi.fn(),
}));

const translate = (key: string): string => {
  switch (key) {
    case "manualPayContinue":
      return "Continue";
    case "manualPayLabel":
      return "Recipient";
    case "manualPayLinkyAliasHint":
      return "Will try {address}";
    case "manualPayPlaceholder":
      return "Lightning address, invoice, LNURL, Cashu request";
    case "manualPaySuggestions":
      return "Matching contacts";
    case "contact":
      return "Contact";
    default:
      return key;
  }
};

const setInputValue = (input: HTMLInputElement, value: string): void => {
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  );
  const setter = descriptor?.set;
  if (!setter) {
    throw new Error("HTML input value setter missing");
  }
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

describe("ManualPayPage", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("autofocuses the recipient input", async () => {
    const { container } = await renderIntoDocument(
      <ManualPayPage
        contacts={[]}
        nostrPictureByNpub={{}}
        onSubmitText={async () => {}}
        t={translate}
      />,
    );

    const input = container.querySelector("input");
    expect(input).toBeInstanceOf(HTMLInputElement);
    expect(document.activeElement).toBe(input);
  });

  it("expands a bare alias to linky.fit before submit", async () => {
    const onSubmitText = vi.fn<ManualPayPagePropsSubmit>();

    const { container } = await renderIntoDocument(
      <ManualPayPage
        contacts={[]}
        nostrPictureByNpub={{}}
        onSubmitText={onSubmitText}
        t={translate}
      />,
    );

    const input = container.querySelector("input");
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("manual pay input missing");
    }
    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Continue",
    );
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error("manual pay submit missing");
    }

    await act(async () => {
      setInputValue(input, "alice");
    });

    expect(container.textContent).toContain("alice@linky.fit");

    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSubmitText).toHaveBeenCalledWith("alice@linky.fit");
  });

  it("pays a typed lightning address as itself even when a contact has it", async () => {
    const onSubmitText = vi.fn<ManualPayPagePropsSubmit>();

    const { container } = await renderIntoDocument(
      <ManualPayPage
        contacts={[
          { id: createId<"Contact">(), name: "Bob", lnAddress: "bob@pay.test" },
        ]}
        nostrPictureByNpub={{}}
        onSubmitText={onSubmitText}
        t={translate}
      />,
    );

    const input = container.querySelector("input");
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("manual pay input missing");
    }
    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Continue",
    );
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error("manual pay submit missing");
    }

    await act(async () => {
      setInputValue(input, "bob@pay.test");
    });
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(navigateTo).not.toHaveBeenCalled();
    expect(onSubmitText).toHaveBeenCalledWith("bob@pay.test");
  });

  it("submits invoices without linky.fit expansion", async () => {
    const onSubmitText = vi.fn<ManualPayPagePropsSubmit>();

    const { container } = await renderIntoDocument(
      <ManualPayPage
        contacts={[]}
        nostrPictureByNpub={{}}
        onSubmitText={onSubmitText}
        t={translate}
      />,
    );

    const input = container.querySelector("input");
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("manual pay input missing");
    }
    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Continue",
    );
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error("manual pay submit missing");
    }

    await act(async () => {
      setInputValue(input, "lnbc123");
    });

    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSubmitText).toHaveBeenCalledWith("lnbc123");
  });
});

type ManualPayPagePropsSubmit = (text: string) => Promise<void>;
