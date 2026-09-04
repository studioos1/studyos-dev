"use client";
import dynamic from "next/dynamic";

// Rendered client-only: the app reads localStorage in a useState initializer, so there's
// nothing meaningful to server-render. This keeps runtime behavior identical to the old
// CDN build while we do the module refactor.
const App = dynamic(() => import("@/components/App"), { ssr: false });

export default function Page() {
  return <App />;
}
