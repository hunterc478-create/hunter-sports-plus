import { loadBundle } from "@/lib/load-dashboard";
import { RecordsPage } from "@/components/hs/views";

export default function Page() {
  return <RecordsPage bundle={loadBundle()} />;
}
