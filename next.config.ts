import type { NextConfig } from "next";

/**
 * Static export so the site can be hosted free on GitHub Pages.
 * The deploy workflow sets PAGES_BASE_PATH to "/<repo-name>" so links work under github.io/<repo-name>/.
 */
const basePath = process.env.PAGES_BASE_PATH || "";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "export",
  trailingSlash: true,
  basePath,
  assetPrefix: basePath || undefined,
  images: { unoptimized: true },
  // client code fetching /data/*.json needs the same prefix
  env: { NEXT_PUBLIC_BASE_PATH: basePath, NEXT_PUBLIC_REPO: process.env.GITHUB_REPOSITORY ?? "" },
};

export default nextConfig;
