import { loadBundle } from "@/lib/load-dashboard";
import { WeekView } from "@/components/hs/views";

export default function Page() {
  return <WeekView bundle={loadBundle()} />;
}
