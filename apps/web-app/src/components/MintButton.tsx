import { ChevronRight } from "lucide-react";
import type { MintBadgeKind, MintIcon as MintIconSource } from "../utils/mint";
import { MintBadge } from "./MintBadge";
import { MintIcon } from "./MintIcon";

interface MintButtonProps {
  badge: MintBadgeKind | null;
  getMintIconUrl: (mint: string | null | undefined) => MintIconSource;
  isSelected: boolean;
  isTestMint?: boolean;
  label: string;
  mint: string;
  onClick: () => void;
}

export function MintButton({
  badge,
  getMintIconUrl,
  isSelected,
  isTestMint = false,
  label,
  mint,
  onClick,
}: MintButtonProps) {
  return (
    <button
      type="button"
      className={`ghost mint-choice${isTestMint ? " is-test-mint" : ""}${isSelected ? " is-selected" : ""}`}
      aria-current={isSelected ? "true" : undefined}
      onClick={onClick}
    >
      <MintIcon getMintIconUrl={getMintIconUrl} mint={mint} />
      <span className="mint-choice-label">{label}</span>
      {badge !== null ? <MintBadge kind={badge} /> : null}
      {isSelected ? (
        <span className="mint-choice-check" aria-hidden="true">
          ✓
        </span>
      ) : null}
      <ChevronRight size={18} className="mint-choice-chevron" aria-hidden />
    </button>
  );
}
