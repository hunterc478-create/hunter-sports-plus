# Server code (not used on GitHub Pages)

GitHub Pages only serves static files, so the live-odds endpoint (`api/odds/route.ts`) lives here for now.
To use it, host the app on a server platform (e.g. Vercel), move `api/` back into `app/`, and remove
`output: "export"` from `next.config.ts`. `hooks/use-live-odds.ts` polls it.
