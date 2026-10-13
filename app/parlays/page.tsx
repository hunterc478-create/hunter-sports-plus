import { loadBundle } from "@/lib/load-dashboard";
import { ParlaysPage } from "@/components/hs/views";

export default function Page() {
  return <ParlaysPage bundle={loadBundle()} />;
}
