import type { Channel, CompanyIdentity } from "@linky-fit/keryx";
import {
  Avatar,
  ContactRow,
  ListRow,
  Row,
  Stack,
  Switch,
  Text,
} from "@linky-fit/ui";
import type { ReactNode } from "react";
import { useKeryxMediaUrl } from "../app/hooks/useKeryxMedia";

interface CompanyProps {
  readonly origin: string;
  readonly identity: CompanyIdentity;
}

const useLogo = ({ origin, identity }: CompanyProps) =>
  useKeryxMediaUrl({
    origin,
    url: identity.logo,
    sha256: identity.logoSha256,
  });

/** The join origin always shows beside the self-asserted name and logo. */
const Origin = ({ origin }: { readonly origin: string }) => (
  <Text variant="caption" mono color="$colorMuted">
    {origin}
  </Text>
);

export function KeryxCompanyHeader({
  origin,
  identity,
  trailing,
}: CompanyProps & { readonly trailing?: ReactNode }) {
  const logo = useLogo({ origin, identity });
  return (
    <Row gap="$md">
      <Avatar name={identity.companyName} uri={logo} icon="Building" />
      <Stack flex={1} gap="$xxs">
        <Text variant="title" numberOfLines={2}>
          {identity.companyName}
        </Text>
        <Origin origin={origin} />
      </Stack>
      {trailing}
    </Row>
  );
}

export function KeryxCompanyRow({
  origin,
  identity,
  onPress,
}: CompanyProps & { readonly onPress: () => void }) {
  const logo = useLogo({ origin, identity });
  return (
    <ContactRow
      name={identity.companyName}
      avatarUri={logo}
      avatarIcon="Building"
      preview={<Origin origin={origin} />}
      onPress={onPress}
      accessibilityLabel={`${identity.companyName} ${origin}`}
    />
  );
}

export function KeryxChannelToggles({
  catalog,
  isFollowed,
  onToggle,
}: {
  readonly catalog: ReadonlyArray<Channel>;
  readonly isFollowed: (name: string) => boolean;
  readonly onToggle: (name: string) => void;
}) {
  return catalog.map((channel) => (
    <ListRow
      key={channel.name}
      icon={channel.name === "security" ? "ShieldAlert" : "Megaphone"}
      title={channel.displayName}
      description={channel.description}
      trailing={
        <Switch
          accessibilityLabel={channel.displayName}
          value={isFollowed(channel.name)}
          onValueChange={() => onToggle(channel.name)}
        />
      }
    />
  ));
}

export function KeryxFooter({ text }: { readonly text: string }) {
  return (
    <Text variant="caption" color="$colorMuted" textAlign="center">
      {text}
    </Text>
  );
}
