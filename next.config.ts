import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Tesseract spawns worker threads and loads WASM from node_modules; keep it out of the bundle.
  serverExternalPackages: ["tesseract.js", "tesseract.js-core", "sharp"],
  experimental: {
    serverActions: { bodySizeLimit: "15mb" },
  },
  // Development is commonly opened from a phone on the LAN to test the mobile join flow.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*"],
};

export default nextConfig;
