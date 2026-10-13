import { loadBundle } from "@/lib/load-dashboard";
import { TrackerView } from "@/components/day/views";

export default function Page() {
  return <TrackerView bundle={loadBundle()} />;
}
