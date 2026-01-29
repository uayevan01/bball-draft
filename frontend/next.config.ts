import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  images: {
    remotePatterns: [
      // Clerk user avatars (common host).
      {
        protocol: "https",
        hostname: "img.clerk.com",
      },
      {
        protocol: "https",
        hostname: "images.clerk.dev",
      },
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
