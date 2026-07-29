import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep the @/* imports deterministic in container builds. TypeScript also
  // defines this alias in tsconfig.json, but the bundler must resolve it too.
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@": appRoot,
    };
    return config;
  },
};

export default nextConfig;
