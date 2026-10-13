"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export function PublicHeader() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="border-b border-[var(--border)] bg-[var(--background)]">
      <div className="container-page flex min-h-[76px] items-center justify-between gap-5">
        <Link
          href="/"
          aria-label="PieChat home"
          className="flex items-center gap-2"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-[var(--primary)] text-lg font-bold text-white">
            P
          </span>
          <span className="text-xl font-bold tracking-tight">PieChat</span>
        </Link>

        <nav className="hidden items-center gap-7 md:flex">
          <a href="#features" className="text-sm text-[var(--muted)]">
            Features
          </a>
          <Link
            href="/about"
            className="text-sm text-[var(--muted)]"
          >
            About
          </Link>
          <Link
            href="/contact"
            className="text-sm text-[var(--muted)]"
          >
            Contact
          </Link>
        </nav>

        <div className="hidden items-center gap-4 md:flex">
          <Link href="/auth" className="text-sm font-semibold">
            Log in
          </Link>
          <Link href="/auth" className="button-primary">
            Get started
          </Link>
        </div>

        <button
          type="button"
          aria-expanded={menuOpen}
          aria-controls="mobile-public-menu"
          onClick={() => setMenuOpen((open) => !open)}
          className="rounded-md border border-[var(--border)] px-3 py-2 text-sm md:hidden"
        >
          {menuOpen ? "Close" : "Menu"}
        </button>
      </div>

      {menuOpen && (
        <nav
          id="mobile-public-menu"
          className="container-page flex flex-col gap-4 border-t border-[var(--border)] py-5 md:hidden"
        >
          <a href="#features" onClick={() => setMenuOpen(false)}>
            Features
          </a>
          <Link href="/about" onClick={() => setMenuOpen(false)}>
            About
          </Link>
          <Link href="/contact" onClick={() => setMenuOpen(false)}>
            Contact
          </Link>
          <Link href="/auth" onClick={() => setMenuOpen(false)}>
            Log in / Sign up
          </Link>
        </nav>
      )}
    </header>
  );
}

export function PublicFooter() {
  const [year, setYear] = useState<number | null>(null);

  useEffect(() => {
    setYear(new Date().getFullYear());
  }, []);

  return (
    <footer className="border-t border-[var(--border)] bg-[var(--background)]">
      <div className="container-page flex flex-col gap-6 py-8 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link href="/" className="font-bold tracking-tight">
            PieChat
          </Link>
          <p className="mt-2 text-sm text-[var(--muted)]">
            A simpler space for your conversations.
          </p>
        </div>

        <nav
          aria-label="Legal and company links"
          className="flex flex-wrap gap-x-5 gap-y-3 text-sm text-[var(--muted)]"
        >
          <Link href="/about">About</Link>
          <Link href="/contact">Contact</Link>
          <Link href="/terms">Terms of Service</Link>
          <Link href="/privacy">Privacy Policy</Link>
        </nav>

        <p className="text-sm text-[var(--muted)]">
          © {year ?? 2026} PieChat
        </p>
      </div>
    </footer>
  );
}
