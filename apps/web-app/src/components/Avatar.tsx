import type { ReactNode } from "react";

interface AvatarProps {
  pictureUrl: string | null | undefined;
  fallback: ReactNode;
  fallbackClassName?: string;
  loading?: "eager" | "lazy";
}

export function Avatar({
  pictureUrl,
  fallback,
  fallbackClassName = "contact-avatar-fallback",
  loading = "lazy",
}: AvatarProps) {
  return pictureUrl ? (
    <img
      src={pictureUrl}
      alt=""
      loading={loading}
      referrerPolicy="no-referrer"
    />
  ) : (
    <span className={fallbackClassName}>{fallback}</span>
  );
}
