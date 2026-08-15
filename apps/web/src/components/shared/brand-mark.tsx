interface BrandMarkProps {
  className?: string;
  size?: number;
}

/**
 * The LinkIQ icon mark, as inline SVG rather than /public/logo.svg —
 * needed anywhere the surrounding theme isn't fixed (the dashboard
 * respects the user's light/dark preference, unlike the marketing
 * site's permanently-dark shell). Inline SVG lets the outline pick up
 * `currentColor` from `text-foreground`, so it re-resolves correctly
 * in whichever theme is active instead of being baked into a static
 * file the way the marketing logo.svg is.
 */
export function BrandMark({ className, size = 28 }: BrandMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect
        x="4"
        y="4"
        width="16"
        height="16"
        rx="6"
        stroke="currentColor"
        strokeWidth="3.25"
        className="text-foreground"
      />
      <rect
        x="12"
        y="12"
        width="16"
        height="16"
        rx="6"
        className="fill-primary"
      />
    </svg>
  );
}
