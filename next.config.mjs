/** @type {import('next').NextConfig} */
const nextConfig = {
  // Don't let `next dev` inject/re-inject its agent-rules block into our hand-written CLAUDE.md.
  agentRules: false,
};

export default nextConfig;
