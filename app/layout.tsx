import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { SiteHeader } from "@/components/hs/site-header";
import { LeagueProvider } from "@/components/hs/league";
import { UpdateLine } from "@/components/hs/update-line";
import { DayProvider } from "@/components/day/day-context";
import { ParlaySlip } from "@/components/dashboard/parlay-slip";
import { loadBundle } from "@/lib/load-dashboard";
import "./globals.css";

const base = process.env.PAGES_BASE_PATH || "";
export const metadata: Metadata = {
  title: "Hunter Sports Plus",
  description: "NBA, NHL, MLB, soccer, college basketball and tennis odds, our picks, props and parlays. No bets are taken here.",
  // home-screen app: icon, full-screen launch, and the name under the icon
  manifest: `${base}/manifest.webmanifest`,
  icons: { icon: `${base}/icon-192.png`, apple: `${base}/apple-touch-icon.png` },
  appleWebApp: { capable: true, title: "Sports Plus", statusBarStyle: "black-translucent" },
};
export const viewport: Viewport = { themeColor: "#0E0F12", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const bundle = loadBundle();
  const slim = { isMock: bundle.isMock, generatedAt: bundle.generatedAt, status: bundle.status };
  return (
    <html lang="en" className={GeistSans.variable}>
      <body className="min-h-screen bg-obsidian font-sans text-ink">
        <LeagueProvider>
        <div className="pt-[env(safe-area-inset-top)]"><SiteHeader /></div>
        <main>
          <DayProvider days={bundle.days} todayKey={bundle.todayKey}>
            <div className="mx-auto max-w-[1200px] px-4 pb-24 pt-4 sm:px-6 lg:pb-12">
              <UpdateLine bundle={slim} />
              {children}
            </div>
          </DayProvider>
        </main>
        <ParlaySlip />
        </LeagueProvider>
      </body>
    </html>
  );
}
