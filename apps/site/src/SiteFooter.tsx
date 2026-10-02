interface SiteFooterProps {
  followUsLabel: string;
  privacyLabel: string;
}

export function SiteFooter({ followUsLabel, privacyLabel }: SiteFooterProps) {
  return (
    <footer className="footer-links">
      <a href="/cashu/">Cashu</a>
      <a href="/follow-us/">{followUsLabel}</a>
      <a href="/privacy.html">{privacyLabel}</a>
    </footer>
  );
}
