import { Card, Image, opacity, Stack, Text } from "@linky-fit/ui";
import { useEffect } from "react";
import { SiteLayout } from "../SiteLayout";
import type { SiteLocale } from "../sitePreferences";
import { useSiteLocale } from "../useSiteLocale";
import { translateArticle } from "./article";
import { articleHref, articles } from "./articles";
import { copy } from "./copy";

function ArticleCard({
  article,
  locale,
}: {
  article: (typeof articles)[number];
  locale: SiteLocale;
}) {
  const { title, description, coverAlt, publishedOn } = translateArticle(
    article,
    locale,
  );
  return (
    <Card
      render={<a href={articleHref(article.slug)} />}
      outlined
      padding="$none"
      gap="$none"
      overflow="hidden"
      hoverStyle={{ opacity: opacity.dimmed }}
    >
      <Image
        src={article.cover}
        alt={coverAlt}
        width="100%"
        aspectRatio={16 / 9}
        objectFit="cover"
      />
      <Stack padding="$lg" gap="$sm">
        <Text variant="caption" color="$colorMuted">
          {publishedOn} · {article.author.name}
        </Text>
        <Text variant="heading" color="$colorStrong">
          {title}
        </Text>
        <Text color="$colorMuted">{description}</Text>
      </Stack>
    </Card>
  );
}

function BlogPage() {
  const [locale, setLocale] = useSiteLocale();
  const activeCopy = copy[locale];

  useEffect(() => {
    document.title = `Linky ${activeCopy.title}`;
  }, [activeCopy.title]);

  return (
    <SiteLayout locale={locale} onLocaleChange={setLocale}>
      <Stack
        width="100%"
        maxWidth="$contentWidth"
        alignSelf="center"
        gap="$xxl"
        paddingVertical="$xxl"
      >
        <Stack gap="$sm">
          <Text
            variant="display"
            color="$colorStrong"
            role="heading"
            aria-level={1}
          >
            {activeCopy.title}
          </Text>
          <Text color="$colorMuted">{activeCopy.description}</Text>
        </Stack>
        {articles.map((article) => (
          <ArticleCard key={article.slug} article={article} locale={locale} />
        ))}
      </Stack>
    </SiteLayout>
  );
}

export default BlogPage;
