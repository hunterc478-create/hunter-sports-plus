import { loadBundle } from "@/lib/load-dashboard";
import { LocksView } from "@/components/day/views";

export default function Page() {
  return <LocksView bundle={loadBundle()} />;
}
