import Link from "next/link";

export function Footer() {
  return (
    <footer className="site-footer">
      <span>Copyright © 2026 Business Craft Online. All Rights Reserved.</span>
      <span className="site-footer-sep" aria-hidden="true">|</span>
      <Link href="/terms" prefetch={false}>
        Terms of Service
      </Link>
    </footer>
  );
}
