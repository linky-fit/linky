import { Avatar, Button, Card, Image, Row, Stack, Text } from "@linky-fit/ui";
import { useEffect } from "react";
import { SiteLayout } from "../SiteLayout";
import { useSiteLocale } from "../useSiteLocale";
import { translateArticle } from "./article";
import type { articles } from "./articles";
import { copy } from "./copy";

const blogLink = { render: <a href="/blog/" />, role: "link" } as const;

function ArticlePage({ article }: { article: (typeof articles)[number] }) {
  const [locale, setLocale] = useSiteLocale();
  const activeCopy = copy[locale];
  const { title, description, coverAlt, publishedOn, bio, language, Body } =
    translateArticle(article, locale);
  const { author } = article;

  useEffect(() => {
    document.title = `${title} · Linky ${activeCopy.title}`;
  }, [title, activeCopy.title]);

  return (
    <SiteLayout locale={locale} onLocaleChange={setLocale}>
      <Stack
        render={<article lang={language} />}
        width="100%"
        maxWidth="$contentWidth"
        alignSelf="center"
        gap="$lg"
        paddingVertical="$xxl"
      >
        <Button
          {...blogLink}
          variant="ghost"
          size="sm"
          icon="ArrowLeft"
          alignSelf="flex-start"
        >
          {activeCopy.allArticlesLabel}
        </Button>
        <Stack gap="$sm">
          <Text eyebrow>{publishedOn}</Text>
          <Text
            variant="display"
            color="$colorStrong"
            role="heading"
            aria-level={1}
          >
            {title}
          </Text>
          <Text variant="title" fontWeight="$regular" color="$colorSubtle">
            {description}
          </Text>
        </Stack>
        <Row gap="$sm">
          <Avatar name={author.name} uri={author.avatar} size="sm" />
          <Text variant="label">{author.name}</Text>
        </Row>
        <Image
          src={article.cover}
          alt={coverAlt}
          width="100%"
          aspectRatio={16 / 9}
          objectFit="cover"
          borderRadius="$card"
        />
        <Body />
        <Card outlined marginTop="$xxl">
          <Row alignItems="flex-start">
            <Avatar name={author.name} uri={author.avatar} />
            <Stack flex={1} gap="$xs">
              <Text eyebrow>{activeCopy.writtenByLabel}</Text>
              <Text variant="title" color="$colorStrong">
                {author.name}
              </Text>
              <Text color="$colorMuted">{bio}</Text>
            </Stack>
          </Row>
        </Card>
      </Stack>
    </SiteLayout>
  );
}

export default ArticlePage;
