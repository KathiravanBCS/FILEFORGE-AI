import Link from 'next/link';
import { IconFiles } from '@tabler/icons-react';
export function Logo({ href = '/' }: { href?: string }) {
  return (
    <Link href={href} className="logo" aria-label="FileForge AI home">
      <span className="logo-mark">
        <IconFiles size={22} stroke={1.6} />
      </span>
      FileForge<span className="logo-ai">AI</span>
    </Link>
  );
}
