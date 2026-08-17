import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Next 16 writes AGENTS.md and CLAUDE.md into the repo root on every dev run.
  // Not wanted here: they are tooling scaffolding, not part of this project.
  agentRules: false,
};

export default nextConfig;
