import { loadBundle } from "@/lib/load-dashboard";
import { PropsView } from "@/components/hs/views";

export default function Page() {
  return <PropsView bundle={loadBundle()} />;
}
