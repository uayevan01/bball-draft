import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "www.basketball-reference.com",
      },
      {
        protocol: "https",
        hostname: "cdn.ssref.net",
      },
      {
        protocol: "http",
        hostname: "cdn.ssref.net",
      },
    ],
  },
};

export default nextConfig;
