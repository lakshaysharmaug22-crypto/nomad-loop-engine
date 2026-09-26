/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Linting runs once for the whole monorepo (npm run lint), not per app build.
  eslint: { ignoreDuringBuilds: true },
  // The contracts package is compiled TypeScript (CommonJS); only its types and zod schemas are used here.
  transpilePackages: ['@nomad/contracts'],
  async headers() {
    return [{ source: '/demo/:path*', headers: [{ key: 'Cache-Control', value: 'public, max-age=3600' }] }];
  },
};

export default nextConfig;
