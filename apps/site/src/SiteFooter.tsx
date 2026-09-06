interface SiteFooterProps {
  githubLabel: string;
  nostrLabel: string;
  privacyLabel: string;
}

export function SiteFooter({
  githubLabel,
  nostrLabel,
  privacyLabel,
}: SiteFooterProps) {
  return (
    <footer className="footer-links">
      <a href="/cashu/">Cashu</a>
      <a
        href="https://github.com/hynek-jina/linky"
        target="_blank"
        rel="noreferrer"
      >
        {githubLabel}
      </a>
      <a href="nostr://npub1kkht6jvgr8mt4844saf80j5jjwyy6fdy90sxsuxt4hfv8pel499s96jvz8">
        {nostrLabel}
      </a>
      <a href="/privacy.html">{privacyLabel}</a>
    </footer>
  );
}
