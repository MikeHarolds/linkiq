import Image from 'next/image';
import Link from 'next/link';

interface LogoProps {
  className?: string;
  wordmarkClassName?: string;
}

/** Icon + wordmark, shared by the marketing header and footer. Not one
 * of the explicitly listed marketing components, but both of those need
 * an identical logo lockup, so factoring it out avoids duplicating the
 * same markup twice. */
export function Logo({ className, wordmarkClassName }: LogoProps) {
  return (
    <Link href="/" className={`flex items-center gap-2 ${className ?? ''}`}>
      <Image src="/logo.svg" alt="" width={28} height={28} priority />
      <span
        className={`text-lg font-semibold tracking-tight text-foreground ${wordmarkClassName ?? ''}`}
      >
        LinkIQ
      </span>
    </Link>
  );
}
