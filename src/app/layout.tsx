import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "LifeCraftOnline",
  description: "Browser-based economy simulation",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="lc-shell">
          <header className="lc-topbar">
            <Link className="lc-brand" href="/">
              LifeCraftOnline
            </Link>
            <nav className="lc-nav" aria-label="Primary">
              <Link href="/dashboard">Dashboard</Link>
              <Link href="/businesses">Businesses</Link>
              <Link href="/inventory">Inventory</Link>
              <Link href="/market">Market</Link>
              <Link href="/production">Production</Link>
              <Link href="/employees">Employees</Link>
              <Link href="/contracts">Contracts</Link>
              <Link href="/travel">Travel</Link>
              <Link href="/banking">Banking</Link>
              <Link href="/login">Login</Link>
            </nav>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
