import { Button, IconButton, ListRow, Row, Sheet, Stack } from "@linky-fit/ui";
import { useState } from "react";
import { siteConfig } from "../config";
import { useCopy, useLocale } from "../locale";
import { siteLocales } from "../sitePreferences";
import { Logo, Wordmark } from "./parts";

/** The sticky, translucent bar: the brand, the app and the language, switched the way the Linky site does it. */
export function SiteHeader() {
  const { nav } = useCopy();
  const { locale, setLocale } = useLocale();
  const [languageSheetIsOpen, setLanguageSheetIsOpen] = useState(false);
  return (
    <Stack
      render="header"
      position="sticky"
      top="$none"
      zIndex="$sticky"
      gap="$none"
      backdropFilter="blur(16px)"
    >
      <Stack
        position="absolute"
        inset={0}
        backgroundColor="$background"
        opacity={0.82}
      />
      <Row
        position="relative"
        width="100%"
        maxWidth="$appWidth"
        alignSelf="center"
        justifyContent="space-between"
        paddingHorizontal="$xl"
        paddingVertical="$md"
      >
        <Row render={<a href="#top" aria-label={nav.home} />} gap="$sm">
          <Logo size={36} />
          <Wordmark />
        </Row>
        <Row gap="$sm">
          <Button
            render={<a href={siteConfig.webAppUrl} />}
            role="link"
            icon="Play"
          >
            {nav.openApp}
          </Button>
          <IconButton
            icon="Languages"
            accessibilityLabel={nav.language}
            tooltip={nav.language}
            onPress={() => setLanguageSheetIsOpen(true)}
          />
        </Row>
      </Row>
      <Sheet
        open={languageSheetIsOpen}
        onOpenChange={setLanguageSheetIsOpen}
        title={nav.language}
      >
        <Stack>
          {siteLocales.map((option) => (
            <ListRow
              key={option}
              title={nav.languages[option]}
              selected={locale === option}
              chevron={false}
              onPress={() => {
                setLocale(option);
                setLanguageSheetIsOpen(false);
              }}
            />
          ))}
        </Stack>
      </Sheet>
    </Stack>
  );
}
