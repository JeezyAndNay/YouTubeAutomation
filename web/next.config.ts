import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow the dev server to be accessed from LAN machines.
  // Update this list if your Mac's LAN IP changes (check with: ipconfig getifaddr en0).
  allowedDevOrigins: ["192.168.1.193"],
};

export default nextConfig;
