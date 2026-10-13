import { loadBundle } from "@/lib/load-dashboard";
import { OurPicksPage } from "@/components/hs/views";

export default function Page() {
  return <OurPicksPage bundle={loadBundle()} />;
}
