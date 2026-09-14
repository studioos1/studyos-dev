/** @type {import('next').NextConfig} */
const nextConfig = {
  // Don't let `next dev` inject/re-inject its agent-rules block into our hand-written CLAUDE.md.
  agentRules: false,
  // The small "N" badge `next dev` shows in a screen corner (dev-only, never in production) —
  // purely a framework debugging aid, not part of the app; off by request.
  devIndicators: false,
};

export default nextConfig;
