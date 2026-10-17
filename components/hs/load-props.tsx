"use client";
import { useState } from "react";

/** The repo whose "Deploy to GitHub Pages" workflow loads props (GitHub sets GITHUB_REPOSITORY during the build). */
const REPO = process.env.NEXT_PUBLIC_REPO || "hunterc478-create/hunter-sports-plus";

/**
 * "Load props now": opens the workflow's Run page on GitHub (sign-in required there). A static public site can't
 * start the run itself without putting a secret key in the page, which anyone could use to burn the API credits.
 */
export function LoadPropsButton({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={compact ? "mt-3" : "mb-6 rounded-lg border border-slate-line bg-slate-card p-4 shadow-card"}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {!compact && (
          <div>
            <div className="font-bold">Props load automatically at 9 AM Central</div>
            <p className="text-sm text-muted-foreground">for games in the next 36 hours. Need them sooner, or fresher after injury news? Load them now.</p>
          </div>
        )}
        <div className="flex items-center gap-3">
          <a href={`https://github.com/${REPO}/actions/workflows/deploy.yml`} target="_blank" rel="noreferrer"
            className="inline-flex h-10 items-center rounded-md bg-brand px-4 text-sm font-bold text-obsidian hover:bg-brand-dim">
            Load props now ↗
          </a>
          <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="text-sm font-semibold text-muted-foreground underline-offset-2 hover:text-ink hover:underline">
            {open ? "Hide steps" : "How?"}
          </button>
        </div>
      </div>
      {open && (
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Tap <b className="text-ink">Load props now</b>. It opens GitHub; sign in if asked.</li>
          <li>Tap <b className="text-ink">Run workflow</b> on the right.</li>
          <li>Check <b className="text-ink">Load player props now</b>, then tap the green <b className="text-ink">Run workflow</b>.</li>
          <li>Wait about 3 minutes, then refresh this page.</li>
        </ol>
      )}
      {open && <p className="mt-2 text-xs text-muted-foreground">Each load costs about 5 of your 500 monthly Odds API credits per game kicking off in the next 36 hours.</p>}
    </div>
  );
}
