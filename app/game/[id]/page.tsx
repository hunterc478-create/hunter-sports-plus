import { loadBundle } from "@/lib/load-dashboard";
import { GameView } from "@/components/hs/views";

/** One static page per game on the board (rebuilt with every update). */
export const dynamicParams = false;
export function generateStaticParams() {
  const ids = loadBundle().byDay.all.matchups.map((c) => ({ id: c.matchup.id }));
  return ids.length ? ids : [{ id: "none" }];   // a static export needs at least one page
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GameView bundle={loadBundle()} id={id} />;
}
