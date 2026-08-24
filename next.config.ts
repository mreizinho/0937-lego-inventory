import type { NextConfig } from "next";

const isGitHubPages = process.env.GITHUB_ACTIONS === "true";
const pagesPrefix = isGitHubPages ? "/0937-lego-inventory" : "";

const nextConfig: NextConfig = {
  output: isGitHubPages ? "export" : undefined,
  assetPrefix: pagesPrefix,
  env: {
    NEXT_PUBLIC_BASE_PATH: pagesPrefix,
    NEXT_PUBLIC_GOOGLE_CLIENT_ID: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "903361544580-2q3vp79k7jv9moq8meincgtr3bhfrmua.apps.googleusercontent.com",
  },
};

export default nextConfig;
