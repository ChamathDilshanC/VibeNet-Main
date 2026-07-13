import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pin the workspace root to this project. A stray lockfile higher up the tree
  // (e.g. in the user's home directory) can otherwise cause Next.js to infer the
  // wrong root and emit a warning during builds.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
