import Image from 'next/image';
import Link from 'next/link';

interface LogoProps {
  className?: string;
  wordmarkClassName?: string;
  /** Admin-configured logo (Sprint 14) — falls back to the bundled
   * default LinkIQ mark when null/unset, matching every other
   * consumer of SiteBranding.logoUrl. */
  logoUrl?: string | null;
  siteName?: string;
}

/** Icon + wordmark, shared by the marketing header and footer. Not one
 * of the explicitly listed marketing components, but both of those need
 * an identical logo lockup, so factoring it out avoids duplicating the
 * same markup twice. */
export function Logo({ className, wordmarkClassName, logoUrl, siteName }: LogoProps) {
  return (
    <Link href="/" className={`flex items-center gap-2 ${className ?? ''}`}>
      {logoUrl ? (
        // An admin-uploaded logo is an arbitrary external/uploads URL,
        // which next/image's static optimization isn't set up for here.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="" width={28} height={28} className="h-7 w-7 object-contain" />
      ) : (
        <Image src="/logo.svg" alt="" width={28} height={28} priority />
      )}
      <span
        className={`text-lg font-semibold tracking-tight text-foreground ${wordmarkClassName ?? ''}`}
      >
        {siteName ?? 'LinkIQ'}
      </span>
    </Link>
  );
}
