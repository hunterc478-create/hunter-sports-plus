import { loadBundle } from "@/lib/load-dashboard";
import { TrackerView } from "@/components/day/views";
import { BestPriceToday } from "@/components/hs/views";

export default function Page() {
  const bundle = loadBundle();
  return (
    <>
      <BestPriceToday bundle={bundle} />
      <div className="mt-12"><TrackerView bundle={bundle} /></div>
    </>
  );
}
