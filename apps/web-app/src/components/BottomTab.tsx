import { Users as ContactsIcon, Wallet as WalletIcon } from "lucide-react";
import type { Ref } from "react";

interface BottomTabProps {
  icon: "contacts" | "wallet";
  isActive: boolean;
  label: string;
  onClick: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
}

export function BottomTab({
  icon,
  isActive,
  label,
  onClick,
  buttonRef,
}: BottomTabProps) {
  const iconContent =
    icon === "contacts" ? <ContactsIcon size={18} /> : <WalletIcon size={18} />;

  return (
    <button
      type="button"
      className={isActive ? "bottom-tab is-active" : "bottom-tab"}
      onClick={onClick}
      aria-current={isActive ? "page" : undefined}
      ref={buttonRef}
    >
      <span className="bottom-tab-icon" aria-hidden="true">
        {iconContent}
      </span>
      <span className="bottom-tab-label">{label}</span>
    </button>
  );
}
