import {
  identityFromNsec,
  LISTING_DESCRIPTION_MAX_LENGTH,
  listingPriceKind,
  type ListingSide,
} from "@linky-fit/linkstr";
import {
  createId,
  NonEmptyString,
  NonEmptyString100,
  NonEmptyString1000,
  PositiveInt,
  sqliteTrue,
  type ListingId,
} from "@linky-fit/linksync";
import {
  Button,
  Row,
  SegmentedControl,
  SelectField,
  Stack,
  Text,
  TextField,
} from "@linky-fit/ui";
import React from "react";
import { reportAppLog } from "../devtools/inspector/appLog";
import { useAtomValue } from "@linky-fit/linkstr-react";
import { useDisplayAmounts, useTranslation } from "../app/hooks/shell";
import {
  useListingRecords,
  useListingsRepository,
} from "../app/hooks/useLinksync";
import {
  encodeListingImage,
  LISTING_SIDES,
  defaultListingUnit,
  filterListingAmountInput,
  listingCurrencyLabel,
  listingFractionDigits,
  listingOfRecord,
  listingPriceInput,
  listingPriceUnits,
  listingWireCurrency,
  normalizeListingAmount,
} from "../app/lib/listings";
import {
  getChatAttachmentRejection,
  uploadPrivateImage,
} from "../app/lib/privateImageMessage";
import {
  contactGroupLabel,
  LISTING_AUDIENCE_KINDS,
  listingAudienceColumn,
  listingAudienceOfRecord,
  type ListingAudience,
} from "../app/lib/listingAudience";
import { runWrite } from "../app/lib/storeWrite";
import { contactGroupsAtom } from "../app/state/contacts/readModel";
import {
  currentNsecAtom,
  currentPubkeyAtom,
} from "../app/state/session/session";
import { allowedDisplayCurrenciesAtom } from "../app/state/shell/displayPrefs";
import { ListingImage } from "../components/ListingImage";
import { navigateTo } from "../hooks/useRouting";
import type { I18nKey } from "../i18n";
import { getUnknownErrorMessage } from "../utils/unknown";
import { pickFile } from "../utils/pickFile";
import { nowSeconds } from "../utils/time";

const SIDE_KEYS: Record<ListingSide, I18nKey> = {
  offer: "listingSideOffer",
  want: "listingSideWant",
};

const isSide = (side: string): side is ListingSide =>
  LISTING_SIDES.some((value) => value === side);

type AudienceKind = ListingAudience["kind"];

const AUDIENCE_KEYS: Record<AudienceKind, { label: I18nKey; hint: I18nKey }> = {
  network: {
    label: "listingAudienceNetwork",
    hint: "listingAudienceNetworkHint",
  },
  contacts: {
    label: "listingAudienceContacts",
    hint: "listingAudienceContactsHint",
  },
  group: { label: "listingAudienceGroup", hint: "listingAudienceGroupHint" },
};

/** Adds a listing, or edits the one with `id`. The price is in one of the display units enabled in Settings, bitcoin stored as sats; zero makes the listing free and no price leaves it to be agreed. */
export function ListingFormPage({
  id = null,
}: {
  id?: ListingId | null;
}): React.ReactElement {
  const { lang, t } = useTranslation();
  const { displayCurrency } = useDisplayAmounts();
  const allowedDisplayCurrencies = useAtomValue(allowedDisplayCurrenciesAtom);
  const repository = useListingsRepository();
  const ownPubkey = useAtomValue(currentPubkeyAtom);
  const records = useListingRecords();
  const existing = id
    ? (records.find((record) => record.id === id) ?? null)
    : null;

  const enabledUnits = React.useMemo(
    () => listingPriceUnits(allowedDisplayCurrencies),
    [allowedDisplayCurrencies],
  );
  const [side, setSide] = React.useState<ListingSide>("offer");
  const { groupNames, groupCounts } = useAtomValue(contactGroupsAtom);
  const [audienceKind, setAudienceKind] =
    React.useState<AudienceKind>("contacts");
  const [group, setGroup] = React.useState<string | null>(null);
  // An edit saves the stored audience back unchanged, even one this release cannot read, until the user picks another.
  const [audienceChanged, setAudienceChanged] = React.useState(false);
  // An edited listing keeps its group even when no contact is in it any more.
  const groupChoices =
    group !== null && !groupNames.includes(group)
      ? [...groupNames, group]
      : groupNames;
  const chosenGroup = group ?? groupNames[0] ?? null;
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [unit, setUnit] = React.useState("");
  // A new listing takes the display unit; an edit keeps the currency it was priced in.
  const [currency, setCurrency] = React.useState(() =>
    defaultListingUnit(displayCurrency, enabledUnits),
  );
  const storedImage = React.useMemo(
    () => (existing ? (listingOfRecord(existing)?.image ?? null) : null),
    [existing],
  );
  const [pickedImage, setPickedImage] = React.useState<File | null>(null);
  const [keepsStoredImage, setKeepsStoredImage] = React.useState(true);
  const image = pickedImage ?? (keepsStoredImage ? storedImage : null);
  const nsec = useAtomValue(currentNsecAtom);
  const [saving, setSaving] = React.useState<"image" | "listing" | null>(null);
  const isSaving = saving !== null;
  const [error, setError] = React.useState<string | null>(null);
  // Add is disabled with gaps; pressing it anyway marks them, and until then an empty form is not an error.
  const [attempted, setAttempted] = React.useState(false);

  // An edit starts from the stored row once it is read.
  const loadedId = React.useRef<ListingId | null>(null);
  React.useEffect(() => {
    if (!existing || loadedId.current === existing.id) return;
    loadedId.current = existing.id;
    if (isSide(existing.side)) setSide(existing.side);
    const audience = listingAudienceOfRecord(existing);
    if (audience !== null) setAudienceKind(audience.kind);
    if (audience?.kind === "group") setGroup(audience.group);
    setTitle(existing.title);
    setDescription(existing.description ?? "");
    setUnit(existing.unit);
    const price = listingPriceInput(
      existing.amount,
      existing.currency,
      enabledUnits,
    );
    const listing = listingOfRecord(existing);
    const byAgreement =
      listing !== null && listingPriceKind(listing) === "by-agreement";
    setAmount(byAgreement ? "" : price.amount);
    setCurrency(price.unit);
  }, [enabledUnits, existing]);

  // Tapping the unit cycles through the enabled display units; an edited listing's own currency stays available when Settings no longer list it.
  const currencyChoices = enabledUnits.includes(currency)
    ? enabledUnits
    : [...enabledUnits, currency];
  const nextCurrency = () => {
    const index = currencyChoices.indexOf(currency);
    const next = currencyChoices[(index + 1) % currencyChoices.length];
    if (next === undefined) return;
    setCurrency(next);
    setAmount(filterListingAmountInput(amount, next));
  };

  // Without a typed price the listing is stored as zero, flagged to be agreed.
  const priceByAgreement = amount.trim().length === 0;
  const normalizedAmount = priceByAgreement
    ? "0"
    : normalizeListingAmount(amount, currency);
  const titleMissing = title.trim().length === 0;
  const unitMissing = unit.trim().length === 0;
  const amountInvalid = normalizedAmount === null;
  const groupMissing = audienceKind === "group" && chosenGroup === null;
  const canSave =
    !titleMissing && !unitMissing && !amountInvalid && !groupMissing;
  const audience: ListingAudience =
    audienceKind === "group"
      ? { kind: "group", group: chosenGroup ?? "" }
      : { kind: audienceKind };
  const fieldError = (missing: boolean, key: I18nKey): string | undefined =>
    attempted && missing ? t(key) : undefined;

  const back = () => navigateTo({ route: "listings" });

  const pickImage = async () => {
    const file = await pickFile("image/*");
    if (!file) return;
    const rejection = file.type.startsWith("image/")
      ? getChatAttachmentRejection(file)
      : "chatAttachmentUnsupported";
    setError(rejection ? t(rejection) : null);
    if (!rejection) setPickedImage(file);
  };

  const removeImage = () => {
    setPickedImage(null);
    setKeepsStoredImage(false);
  };

  /** The `image` column to write: a fresh upload, null to clear, or undefined to leave it as it is. */
  const imageColumn = async (): Promise<NonEmptyString | null | undefined> => {
    if (pickedImage === null) {
      return storedImage !== null && !keepsStoredImage ? null : undefined;
    }
    const secretKey = nsec ? identityFromNsec(nsec)?.secretKey : undefined;
    if (!secretKey) throw new Error("listing-image-no-identity");
    const uploaded = await uploadPrivateImage(pickedImage, {
      privateKey: secretKey,
    });
    reportAppLog({
      tag: "listings.imageUploaded",
      summary: "Listing photo uploaded",
      payload: {
        fileType: uploaded.fileType,
        encryptedSize: uploaded.encryptedSize,
        width: uploaded.width,
        height: uploaded.height,
      },
    });
    return NonEmptyString.orThrow(encodeListingImage(uploaded));
  };

  const save = async () => {
    if (!canSave || normalizedAmount === null) return;
    setSaving(pickedImage ? "image" : "listing");
    setError(null);
    let imageValue: NonEmptyString | null | undefined;
    try {
      imageValue = await imageColumn();
    } catch (cause) {
      reportAppLog({
        tag: "listings.imageUploadFailed",
        summary: "Listing photo could not be uploaded",
        payload: { error: getUnknownErrorMessage(cause, "unknown") },
      });
      setSaving(null);
      setError(t("listingImageUploadFailed"));
      return;
    }
    setSaving("listing");
    const trimmedDescription = description.trim();
    const descriptionValue = trimmedDescription
      ? NonEmptyString1000.orThrow(trimmedDescription)
      : null;
    const audienceValue = listingAudienceColumn(audience);
    const columns = {
      side: NonEmptyString100.orThrow(side),
      title: NonEmptyString1000.orThrow(title.trim()),
      amount: NonEmptyString100.orThrow(normalizedAmount),
      currency: NonEmptyString100.orThrow(listingWireCurrency(currency)),
      unit: NonEmptyString100.orThrow(unit.trim()),
      ...(imageValue === undefined ? {} : { image: imageValue }),
    };
    const priceByAgreementValue = priceByAgreement ? sqliteTrue : null;
    const outcome = await runWrite(
      existing
        ? repository.update(existing.id, {
            ...columns,
            description: descriptionValue,
            priceByAgreement: priceByAgreementValue,
            ...(audienceChanged ? { audience: audienceValue } : {}),
          })
        : repository.insert({
            id: createId<"Listing">(),
            createdAtSec: PositiveInt.orThrow(nowSeconds()),
            ...columns,
            ...(descriptionValue === null
              ? {}
              : { description: descriptionValue }),
            ...(priceByAgreementValue === null
              ? {}
              : { priceByAgreement: priceByAgreementValue }),
            ...(audienceValue === null ? {} : { audience: audienceValue }),
          }),
    );
    setSaving(null);
    if (!outcome.ok) {
      setError(outcome.error);
      return;
    }
    reportAppLog({
      tag: existing ? "listings.edited" : "listings.added",
      summary: `Listing ${existing ? "edited" : "added"}: ${side}`,
      payload: {
        side,
        currency,
        hasImage: image !== null,
        audience: audience.kind,
      },
    });
    if (existing && ownPubkey) {
      navigateTo({
        route: "listing",
        author: ownPubkey,
        listingId: existing.id,
      });
    } else {
      back();
    }
  };

  const remove = async () => {
    if (!existing) return;
    setSaving("listing");
    const outcome = await runWrite(repository.remove(existing.id));
    setSaving(null);
    if (!outcome.ok) {
      setError(outcome.error);
      return;
    }
    reportAppLog({
      tag: "listings.removed",
      summary: "Listing removed",
      payload: {},
    });
    back();
  };

  return (
    <Stack gap="$lg">
      <SegmentedControl
        accessibilityLabel={t("listingSide")}
        value={side}
        options={LISTING_SIDES.map((value) => ({
          value,
          label: t(SIDE_KEYS[value]),
        }))}
        onValueChange={setSide}
      />
      <TextField
        label={t("listingTitle")}
        placeholder={t("listingTitlePlaceholder")}
        value={title}
        onChangeText={setTitle}
        maxLength={120}
        error={fieldError(titleMissing, "listingTitleMissing")}
        testID="listing-title"
      />
      <TextField
        multiline
        label={t("listingDescription")}
        placeholder={t("listingDescriptionPlaceholder")}
        value={description}
        onChangeText={setDescription}
        maxLength={LISTING_DESCRIPTION_MAX_LENGTH}
        testID="listing-description"
      />
      <Row gap="$sm" alignItems="flex-start">
        <Stack flex={1} minWidth={0}>
          <TextField
            label={t("listingPrice")}
            placeholder={t("listingPriceByAgreement")}
            inputMode={
              listingFractionDigits(currency) > 0 ? "decimal" : "numeric"
            }
            value={amount}
            onChangeText={(text) =>
              setAmount(filterListingAmountInput(text, currency))
            }
            error={fieldError(amountInvalid, "listingPriceInvalid")}
            trailing={
              <Button
                variant="ghost"
                size="sm"
                onPress={nextCurrency}
                disabled={currencyChoices.length < 2}
                tooltip={t("listingCurrency")}
                aria-label={`${t("listingCurrency")}: ${listingCurrencyLabel(currency, lang)}`}
                testID="listing-currency"
              >
                {listingCurrencyLabel(currency, lang)}
              </Button>
            }
            testID="listing-amount"
          />
        </Stack>
        <Stack flex={1} minWidth={0}>
          <TextField
            label={t("listingUnit")}
            placeholder={t("listingUnitPlaceholder")}
            value={unit}
            onChangeText={setUnit}
            maxLength={40}
            error={fieldError(unitMissing, "listingUnitMissing")}
            testID="listing-unit"
          />
        </Stack>
      </Row>
      <Stack gap="$sm">
        <Text variant="label">{t("listingAudience")}</Text>
        <SegmentedControl
          accessibilityLabel={t("listingAudience")}
          value={audienceKind}
          options={LISTING_AUDIENCE_KINDS.map((value) => ({
            value,
            label: t(AUDIENCE_KEYS[value].label),
          }))}
          onValueChange={(next) => {
            setAudienceKind(next);
            setAudienceChanged(true);
          }}
        />
        {audienceKind === "group" && chosenGroup !== null ? (
          <SelectField
            label={t("listingAudienceGroupPick")}
            value={chosenGroup}
            options={groupChoices.map((name) => ({
              value: name,
              label: contactGroupLabel(name, groupCounts),
            }))}
            onValueChange={(next) => {
              setGroup(next);
              setAudienceChanged(true);
            }}
          />
        ) : null}
        <Text
          variant="caption"
          color={groupMissing ? "$dangerText" : "$colorMuted"}
          testID="listing-audience-hint"
        >
          {t(
            groupMissing
              ? "listingAudienceNoGroups"
              : AUDIENCE_KEYS[audienceKind].hint,
          )}
        </Text>
      </Stack>
      {image ? (
        <Stack gap="$sm">
          <ListingImage source={image} label={t("listingImage")} t={t} />
          <Row gap="$sm">
            <Button
              variant="secondary"
              size="sm"
              icon="ImagePlus"
              disabled={isSaving}
              onPress={() => void pickImage()}
              testID="listing-image-replace"
            >
              {t("listingImageReplace")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon="Trash2"
              disabled={isSaving}
              onPress={removeImage}
              testID="listing-image-remove"
            >
              {t("listingImageRemove")}
            </Button>
          </Row>
        </Stack>
      ) : (
        <Button
          variant="secondary"
          icon="ImagePlus"
          disabled={isSaving}
          onPress={() => void pickImage()}
          testID="listing-image-add"
        >
          {t("listingImageAdd")}
        </Button>
      )}
      {error ? (
        <Text variant="caption" color="$dangerText">
          {error}
        </Text>
      ) : null}
      <Button
        icon="Check"
        disabled={!canSave || isSaving}
        loading={isSaving}
        onDisabledPress={() => setAttempted(true)}
        onPress={() => void save()}
        testID="listing-save"
      >
        {saving === "image"
          ? t("listingImageUploading")
          : t(existing ? "listingSave" : "listingAdd")}
      </Button>
      {existing ? (
        <Button
          variant="ghost"
          icon="Trash2"
          disabled={isSaving}
          onPress={() => void remove()}
        >
          {t("listingRemove")}
        </Button>
      ) : null}
    </Stack>
  );
}
