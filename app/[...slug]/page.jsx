"use client";
import dynamic from "next/dynamic";

// Catch-all so a fresh load (not just a same-session navigation) of a tab's own URL — e.g.
// www.studyos.io/courses, /today, /preferences — resolves to the app instead of 404ing. Next.js
// App Router needs a real route file to match a path; this one matches EVERY path not already
// claimed by a more specific route (/, /privacy, /sms-optin, /terms, /api/*, all of which still
// win over this catch-all since Next resolves the more specific match first). The `[...slug]`
// param itself is intentionally unused here — components/App.jsx independently reads
// window.location.pathname (via tabFromLocation()) to decide which tab to open, since the actual
// "routing" is still the app's own client-side tab state, not a server-rendered per-route page;
// this file's only job is to keep Next from treating an unrecognized path as a 404 before the app
// even gets to run. An entirely unknown slug (a typo, an old bookmark) still resolves here and
// just falls back to the Today tab, same as tabFromLocation()'s own default.
const App = dynamic(() => import("@/components/App"), { ssr: false });

export default function Page() {
  return <App />;
}
