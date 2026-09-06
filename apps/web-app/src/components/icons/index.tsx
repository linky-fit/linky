import type { LucideProps } from "lucide-react";

export function RequestIcon({ size = 24, ...props }: LucideProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M12 3v11.8c0 1.7-.7 3.3-1.9 4.5L7 22.4 2.6 18l4.2-4.2L9.9 3.7A1.1 1.1 0 0 1 12 4Z" />
      <path d="M12 3v11.8c0 1.7.7 3.3 1.9 4.5l3.1 3.1 4.4-4.4-4.2-4.2-3.1-10.1A1.1 1.1 0 0 0 12 4Z" />
      <path d="m4.8 15.8 4.4 4.4M19.2 15.8l-4.4 4.4" />
    </svg>
  );
}
