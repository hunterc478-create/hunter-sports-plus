import { loadBundle } from "@/lib/load-dashboard";
import { TotalsPage } from "@/components/hs/views";

export default function Page() {
  return <TotalsPage bundle={loadBundle()} />;
}
