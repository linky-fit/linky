import {
  GENERIC_MINT_ICON_DATA_URL,
  isLightningAddress,
} from "@linky-fit/linkshu";
import {
  Amount,
  Avatar,
  Button,
  Card,
  Divider,
  Form,
  Icon,
  LoadingState,
  Notice,
  opacity,
  Pill,
  Pressable,
  QRCode,
  Row,
  Stack,
  SubmitButton,
  Text,
  TextField,
  useMedia,
  type IconName,
} from "@linky-fit/ui";
import type { ReactNode } from "react";
import { SiteLayout } from "../SiteLayout";
import { useCashuPage } from "./useCashuPage";

function PageColumn({ children }: { children: ReactNode }) {
  return (
    <Stack
      width="100%"
      maxWidth="$contentWidth"
      alignSelf="center"
      gap="$xxl"
      paddingVertical="$xxl"
    >
      {children}
    </Stack>
  );
}

function PageCard({
  children,
  testID,
}: {
  children: ReactNode;
  testID?: string;
}) {
  return (
    <Card
      outlined
      testID={testID}
      gap="$lg"
      padding="$xxl"
      $compact={{ padding: "$lg" }}
    >
      {children}
    </Card>
  );
}

function OptionColumn({
  icon,
  title,
  description,
  children,
}: {
  icon: IconName;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Stack gap="$md" $wide={{ flex: 1 }}>
      <Row gap="$sm">
        <Icon name={icon} color="$colorMuted" />
        <Text variant="title" color="$colorStrong">
          {title}
        </Text>
      </Row>
      <Text color="$colorMuted">{description}</Text>
      {children}
    </Stack>
  );
}

function CashuPage() {
  const {
    locale,
    setLocale,
    tokenInput,
    setTokenInput,
    activeToken,
    tokenState,
    lightningAddress,
    setLightningAddress,
    redeemError,
    setRedeemError,
    redeemSuccess,
    isInspecting,
    isRedeeming,
    isAdditionalOptionsVisible,
    setIsAdditionalOptionsVisible,
    mintIconSrc,
    setMintIconSrc,
    tokenFitsQr,
    activeCopy,
    tokenErrorMessage,
    displayedTokenAmount,
    cycleDisplayCurrency,
    handleInspectSubmit,
    handleRedeemSubmit,
    handleCopyToken,
    handleOpenInWallet,
  } = useCashuPage();
  const { wide } = useMedia();

  const successView = redeemSuccess ? (
    <PageCard testID="cashu-success">
      <Stack alignItems="center" gap="$md">
        <Stack
          width="$controlLg"
          height="$controlLg"
          borderRadius="$pill"
          backgroundColor="$accentSoft"
          alignItems="center"
          justifyContent="center"
        >
          <Icon name="Check" size="lg" color="$accentText" />
        </Stack>
        <Text
          variant="heading"
          color="$colorStrong"
          role="heading"
          aria-level={1}
        >
          {activeCopy.redeemConfirmed}
        </Text>
        <Text color="$colorMuted" textAlign="center">
          {activeCopy.redeemSuccessAddress.replace(
            "{address}",
            redeemSuccess.lightningAddress,
          )}
        </Text>
      </Stack>
    </PageCard>
  ) : null;

  const entryView = (
    <>
      <Stack gap="$sm">
        <Text eyebrow>Cashu</Text>
        <Text
          variant={wide ? "display" : "heading"}
          color="$colorStrong"
          role="heading"
          aria-level={1}
        >
          {activeCopy.pageTitle}
        </Text>
        <Text color="$colorMuted">{activeCopy.subtitle}</Text>
      </Stack>
      <PageCard>
        <Form onSubmit={handleInspectSubmit} gap="$lg">
          <TextField
            id="cashu-token-input"
            label={activeCopy.tokenLabel}
            multiline
            minHeight="$column"
            value={tokenInput}
            onChangeText={setTokenInput}
            placeholder="cashuA..."
            spellCheck={false}
            error={tokenErrorMessage ?? undefined}
          />
          <SubmitButton
            alignSelf="flex-start"
            $compact={{ alignSelf: "stretch" }}
          >
            {activeCopy.showTokenButton}
          </SubmitButton>
        </Form>
      </PageCard>
    </>
  );

  const tokenDetails = isInspecting ? (
    <LoadingState label={activeCopy.loadingToken} />
  ) : tokenState && !tokenState.isValid ? (
    <Row gap="$sm" flexWrap="wrap">
      <Pill label={activeCopy.statusSpent} tone="danger" />
      <Text color="$colorMuted">{activeCopy.spentInfo}</Text>
    </Row>
  ) : tokenState ? (
    <>
      <Text color="$colorMuted">{activeCopy.payoutIntro}</Text>
      <Button
        variant="accent"
        size="sm"
        alignSelf="flex-start"
        aria-expanded={isAdditionalOptionsVisible}
        onPress={() => setIsAdditionalOptionsVisible((visible) => !visible)}
      >
        {isAdditionalOptionsVisible
          ? activeCopy.collapseOptionsLabel
          : activeCopy.expandOptionsLabel}
      </Button>
      {isAdditionalOptionsVisible ? (
        <>
          <Divider />
          <Stack gap="$xxl" $wide={{ flexDirection: "row" }}>
            <OptionColumn
              icon="Zap"
              title={activeCopy.lightningAddressLabel}
              description={activeCopy.lightningOptionDescription}
            >
              <Form onSubmit={() => void handleRedeemSubmit()}>
                <TextField
                  id="cashu-ln-address"
                  label={activeCopy.lightningAddressLabel}
                  hideLabel
                  inputMode="email"
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={lightningAddress}
                  onChangeText={(value) => {
                    setLightningAddress(value);
                    if (redeemError) setRedeemError(null);
                  }}
                  placeholder={activeCopy.lightningAddressPlaceholder}
                />
                <SubmitButton
                  variant="secondary"
                  loading={isRedeeming}
                  disabled={!isLightningAddress(lightningAddress.trim())}
                >
                  {isRedeeming ? activeCopy.redeeming : activeCopy.redeemButton}
                </SubmitButton>
                {redeemError ? (
                  <Notice tone="danger" title={redeemError} />
                ) : null}
              </Form>
            </OptionColumn>
            <Divider $wide={{ display: "none" }} />
            <OptionColumn
              icon="Bean"
              title={activeCopy.cashuLabel}
              description={activeCopy.cashuOptionDescription}
            >
              {tokenFitsQr ? (
                <QRCode
                  value={activeToken}
                  accessibilityLabel={activeCopy.cashuLabel}
                  tooltip={activeCopy.cashuLabel}
                  onPress={() => void handleCopyToken()}
                />
              ) : null}
            </OptionColumn>
          </Stack>
        </>
      ) : null}
    </>
  ) : tokenErrorMessage ? (
    <Notice tone="danger" title={tokenErrorMessage} />
  ) : (
    <Text color="$colorMuted">{activeCopy.noTokenLoaded}</Text>
  );

  const tokenView = (
    <PageCard>
      <Text eyebrow>Cashu</Text>
      <Row
        justifyContent="space-between"
        gap="$lg"
        $compact={{ flexDirection: "column", alignItems: "stretch" }}
      >
        <Row gap="$md">
          {tokenState ? (
            <Avatar
              name={tokenState.mintHost}
              uri={mintIconSrc}
              onError={() => setMintIconSrc(GENERIC_MINT_ICON_DATA_URL)}
            />
          ) : null}
          <Stack gap="$xxs">
            <Pressable
              testID="cashu-token-amount"
              aria-label={activeCopy.currencyLabel}
              tooltip={activeCopy.currencyLabel}
              onPress={cycleDisplayCurrency}
              gap="$sm"
              alignSelf="flex-start"
              opacity={tokenState && !tokenState.isValid ? opacity.dimmed : 1}
            >
              <Amount
                value={displayedTokenAmount.value}
                unit={displayedTokenAmount.unit}
              />
              <Icon name="Repeat" size="sm" color="$colorMuted" />
            </Pressable>
            {tokenState?.mintHost ? (
              <Text variant="label" color="$colorMuted">
                {tokenState.mintHost}
              </Text>
            ) : null}
          </Stack>
        </Row>
        {tokenState?.isValid && !isInspecting ? (
          <Button
            icon="Send"
            tooltip={activeCopy.openInWalletLabel}
            onPress={handleOpenInWallet}
          >
            {activeCopy.linkyPrimaryAction}
          </Button>
        ) : null}
      </Row>
      {tokenDetails}
    </PageCard>
  );

  return (
    <SiteLayout locale={locale} onLocaleChange={setLocale}>
      <PageColumn>
        {successView ?? (activeToken ? tokenView : entryView)}
      </PageColumn>
    </SiteLayout>
  );
}

export default CashuPage;
