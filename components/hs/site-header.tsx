"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, CalendarDays, Layers, ListChecks, Lock, MoreHorizontal, Star, Trophy, Wallet, Scale } from "lucide-react";
import { cn } from "@/lib/utils";
import { LeagueSwitch } from "./league";

type Item = { href: string; label: string; icon: typeof Star };
const NAV: Item[] = [
  { href: "/", label: "Today", icon: CalendarDays },
  { href: "/tracker", label: "Best price", icon: Activity },
  { href: "/best-bets", label: "Best Bets", icon: Star },
  { href: "/props", label: "Props", icon: Layers },
  { href: "/totals", label: "O/U", icon: Scale },
  { href: "/locks", label: "Locks", icon: Lock },
  { href: "/parlays", label: "Parlays", icon: ListChecks },
  { href: "/my-bets", label: "My Bets", icon: Wallet },
  { href: "/our-picks", label: "Our Picks", icon: Trophy },
];
const TABS = NAV.filter((n) => ["/", "/best-bets", "/props", "/my-bets"].includes(n.href));

/** Top bar: wordmark + tagline, then the section links. Phones get a bottom tab bar instead of the links. */
export function SiteHeader() {
  const path = usePathname();
  const is = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <>
      <header className="sticky top-0 z-30 border-b border-slate-line bg-obsidian/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1200px] items-center gap-6 px-4 py-3 sm:px-6">
          <Link href="/" className="flex shrink-0 items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-md bg-brand text-[17px] font-black tracking-tighter text-obsidian">H+</span>
            <span className="leading-tight">
              <span className="block text-[17px] font-black tracking-tight text-ink">Hunter Sports Plus</span>
              <span className="block text-[11px] text-muted-foreground">NBA, NHL, MLB, soccer, college hoops &amp; tennis · no bets taken here</span>
            </span>
          </Link>
          <nav aria-label="Main" className="ml-auto hidden items-center gap-0.5 lg:flex">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} aria-current={is(n.href) ? "page" : undefined}
                className={cn("whitespace-nowrap rounded-md px-1.5 py-2 text-[13px] font-semibold transition-colors",
                  is(n.href) ? "bg-brand text-obsidian" : "text-ink/70 hover:bg-slate-raised hover:text-ink")}>
                {n.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="mx-auto max-w-[1200px] px-4 pb-2 sm:px-6"><LeagueSwitch /></div>
      </header>
      <PhoneTabs is={is} path={path} />
    </>
  );
}

function PhoneTabs({ is, path }: { is: (href: string) => boolean; path: string }) {
  const [more, setMore] = useState(false);
  useEffect(() => setMore(false), [path]);
  const rest = NAV.filter((n) => !TABS.includes(n));
  return (
    <div className="lg:hidden">
      {more && (
        <>
          <button type="button" aria-label="Close menu" onClick={() => setMore(false)} className="fixed inset-0 z-40 bg-black/60" />
          <nav aria-label="More pages" className="fixed inset-x-0 bottom-16 z-50 rounded-t-xl border-t border-slate-line bg-slate-card p-2 pb-3 shadow-lg">
            {rest.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} aria-current={is(href) ? "page" : undefined}
                className={cn("flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-semibold", is(href) ? "bg-brand-soft text-brand" : "text-ink")}>
                <Icon className="h-4 w-4" />{label}
              </Link>
            ))}
          </nav>
        </>
      )}
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-50 grid h-16 grid-cols-5 border-t border-slate-line bg-slate-card pb-[env(safe-area-inset-bottom)]">
        {TABS.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} aria-current={is(href) ? "page" : undefined}
            className={cn("flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold", is(href) ? "text-brand" : "text-muted-foreground")}>
            <Icon className="h-5 w-5" />{label}
          </Link>
        ))}
        <button type="button" onClick={() => setMore(!more)} aria-expanded={more}
          className={cn("flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold", more || rest.some((n) => is(n.href)) ? "text-brand" : "text-muted-foreground")}>
          <MoreHorizontal className="h-5 w-5" />More
        </button>
      </nav>
    </div>
  );
}
