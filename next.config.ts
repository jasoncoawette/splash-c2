import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Railway runs the container, not a Next platform, so the build has to emit
  // its own server and the node_modules it actually uses. Without this the
  // image needs the whole dependency tree at runtime.
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
