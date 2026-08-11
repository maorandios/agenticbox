import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prevent next dev from rewriting AGENTS.md on every boot (can churn the watcher).
  agentRules: false,
};

export default nextConfig;
