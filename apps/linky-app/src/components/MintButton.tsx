import { Icon, ListRow, Row } from "@linky-fit/ui";
import type { MintBadgeKind, MintIcon as MintIconSource } from "../utils/mint";
import { MintBadge } from "./MintBadge";
import { MintIcon } from "./MintIcon";

interface MintButtonProps {
  badge: MintBadgeKind | null;
  chevron?: boolean;
  disabled?: boolean;
  getMintIconUrl: (mint: string | null | undefined) => MintIconSource;
  isSelected: boolean;
  label: string;
  mint: string;
  onPress: () => void;
}

export function MintButton({
  badge,
  chevron = true,
  disabled = false,
  getMintIconUrl,
  isSelected,
  label,
  mint,
  onPress,
}: MintButtonProps) {
  return (
    <ListRow
      leading={<MintIcon getMintIconUrl={getMintIconUrl} mint={mint} />}
      title={label}
      trailing={
        <Row gap="$sm">
          {badge !== null ? <MintBadge kind={badge} /> : null}
          {isSelected ? (
            <Icon name="Check" size="sm" color="$accentText" />
          ) : null}
        </Row>
      }
      chevron={chevron}
      disabled={disabled}
      selected={isSelected}
      onPress={onPress}
    />
  );
}
