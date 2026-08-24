import type { NextConfig } from "next";

const isGitHubPages = process.env.GITHUB_ACTIONS === "true";
const pagesPrefix = isGitHubPages ? "/0937-lego-inventory" : "";

const nextConfig: NextConfig = {
  output: isGitHubPages ? "export" : undefined,
  assetPrefix: pagesPrefix,
  env: {
    NEXT_PUBLIC_BASE_PATH: pagesPrefix,
  },
};

export default nextConfig;
