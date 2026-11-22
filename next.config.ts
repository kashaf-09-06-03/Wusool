import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Tesseract spawns worker threads and loads WASM from node_modules; keep it out of the bundle.
  serverExternalPackages: ["tesseract.js", "tesseract.js-core", "sharp"],
  experimental: {
    serverActions: { bodySizeLimit: "15mb" },
  },
  // Development is commonly opened from a phone on the LAN to test the mobile join flow.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*"],
  // The SQLite database and uploads live in ./.data inside the project. Without this, every DB write
  // (sign-in, new outing, story, receipt) made the dev server recompile the app, which stalled the next
  // page load for seconds and occasionally crashed a request mid-rebuild.
  webpack: (config, { dev }) => {
    if (dev) {
      const ignored = config.watchOptions?.ignored;
      const dataDir = /[\\/]\.data([\\/]|$)/;
      config.watchOptions = {
        ...config.watchOptions,
        ignored:
          ignored instanceof RegExp
            ? new RegExp(`(?:${ignored.source})|(?:${dataDir.source})`)
            : [...(Array.isArray(ignored) ? ignored : ignored ? [ignored] : []), "**/.data/**"],
      };
    }
    return config;
  },
};

export default nextConfig;
