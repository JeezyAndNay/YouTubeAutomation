"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/app/actions/auth";

const nav = [
  { href: "/episodes", label: "Episodes" },
  { href: "/ideas",    label: "Idea Catalog" },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <nav className="w-56 shrink-0 bg-deep-teal flex flex-col border-r border-weathered-stone/20">
      {/* Logo */}
      <div className="px-6 py-6 border-b border-weathered-stone/20">
        <span className="font-display text-sm tracking-[0.15em] uppercase text-bone-white">
          RUINS
        </span>
        <span className="font-display text-sm tracking-[0.15em] uppercase text-portal-gold mx-1">
          ☥
        </span>
        <span className="font-display text-sm tracking-[0.15em] uppercase text-portal-gold">
          UNTOLD
        </span>
        <p className="text-weathered-stone text-[10px] mt-1 tracking-widest uppercase">
          Pipeline
        </p>
      </div>

      {/* Nav links */}
      <ul className="flex-1 py-4 space-y-1 px-3">
        {nav.map(({ href, label }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <li key={href}>
              <Link
                href={href}
                className={[
                  "flex items-center gap-3 px-3 py-2 rounded text-sm transition-colors",
                  active
                    ? "bg-portal-gold/15 text-portal-gold border-l-2 border-portal-gold pl-2.5"
                    : "text-bone-white hover:bg-deep-teal/60 hover:text-portal-gold",
                ].join(" ")}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>

      {/* Footer */}
      <div className="px-6 py-4 border-t border-weathered-stone/20 space-y-2">
        <p className="text-weathered-stone text-[10px]">n8n · localhost:5678</p>
        <form action={logout}>
          <button
            type="submit"
            className="text-weathered-stone/60 hover:text-weathered-stone text-[10px] uppercase tracking-widest transition-colors"
          >
            Sign out
          </button>
        </form>
      </div>
    </nav>
  );
}
