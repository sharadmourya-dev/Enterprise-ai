/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@enterprise-ai/shared-types'],
  output: 'standalone',
  async redirects() {
    return [
      {
        source: '/dashboard',
        destination: '/',
        permanent: true,
      },
      {
        source: '/admin/documents',
        destination: '/documents',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
