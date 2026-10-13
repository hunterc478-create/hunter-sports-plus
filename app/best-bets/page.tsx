import { loadBundle } from "@/lib/load-dashboard";
import { BestBetsView } from "@/components/hs/views";

export default function Page() {
  return <BestBetsView bundle={loadBundle()} />;
}
