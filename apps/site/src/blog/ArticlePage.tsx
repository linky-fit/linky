import {
  Avatar,
  Button,
  Divider,
  Image,
  opacity,
  Row,
  Stack,
  Text,
} from "@linky-fit/ui";
import { useEffect } from "react";
import { SiteLayout } from "../SiteLayout";
import { useSiteLocale } from "../useSiteLocale";
import { translateArticle, type Author } from "./article";
import type { articles } from "./articles";
import { copy } from "./copy";

const blogLink = { render: <a href="/blog/" />, role: "link" } as const;

function AuthorProfile({
  author,
  bio,
  label,
}: {
  author: Author;
  bio: string;
  label: string;
}) {
  const socials = [
    ...(author.nostr
      ? [
          {
            name: "Nostr",
            icon: "/nostr.svg",
            href: `https://njump.me/${author.nostr}`,
          },
        ]
      : []),
    ...(author.x
      ? [{ name: "X", icon: "/x.svg", href: `https://x.com/${author.x}` }]
      : []),
  ];
  return (
    <Stack alignItems="center" gap="$md">
      <Avatar name={author.name} uri={author.avatar} size="lg" />
      <Stack alignItems="center" gap="$xs">
        <Text eyebrow>{label}</Text>
        <Text variant="heading" color="$colorStrong">
          {author.name}
        </Text>
      </Stack>
      <Text color="$colorMuted" textAlign="center" maxWidth="$sheetWidth">
        {bio}
      </Text>
      <Row gap="$md">
        {socials.map(({ name, icon, href }) => (
          <Stack
            key={name}
            render={
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                aria-label={`${author.name} · ${name}`}
              />
            }
            hoverStyle={{ opacity: opacity.dimmed }}
          >
            <Image src={icon} width="$iconXl" height="$iconXl" aria-hidden />
          </Stack>
        ))}
      </Row>
    </Stack>
  );
}

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
        <Divider marginVertical="$xxl" />
        <AuthorProfile
          author={author}
          bio={bio}
          label={activeCopy.writtenByLabel}
        />
      </Stack>
    </SiteLayout>
  );
}

export default ArticlePage;
