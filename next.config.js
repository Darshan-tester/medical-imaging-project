/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  webpack: (config) => {
    // adm-zip optionally requires Electron's "original-fs" module, which
    // doesn't exist under plain Node.js. It's never actually reached at
    // runtime here — this just stops webpack from warning about it.
    config.resolve.alias = { ...config.resolve.alias, "original-fs": false };
    return config;
  },
};

module.exports = nextConfig;
