"use client";
import { createContext, useContext, useState } from "react";

interface DayState { day: string; setDay: (d: string) => void; days: string[]; todayKey: string }
const Ctx = createContext<DayState | null>(null);
const STORE = "ea-day";

/** Hunter's Sauce works in NFL weeks: every page shows the whole week. */
function pickDefault(_days: string[], _today: string) {
  return "all";
}

export function DayProvider({ days, todayKey, children }: { days: string[]; todayKey: string; children: React.ReactNode }) {
  const [day, setDayState] = useState(() => pickDefault(days, todayKey));
  void STORE;
  const setDay = (d: string) => {
    setDayState(d);
    try { localStorage.setItem(STORE, d); } catch {}
  };
  return <Ctx.Provider value={{ day, setDay, days, todayKey }}>{children}</Ctx.Provider>;
}

export function useDay(): DayState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDay must be used inside <DayProvider>");
  return v;
}
