/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: true,
  },
  transpilePackages: [],
  async rewrites() {
    // Dev 模式使用 Docker 内部 Traefik 网关，统一路由到所有后端服务
    const coreUrl = process.env.NEXT_PUBLIC_API_URL || 'http://traefik:80';
    const aiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://traefik:80';
    const obsUrl = process.env.NEXT_PUBLIC_API_URL || 'http://traefik:80';
    return [
      {
        source: '/api/v1/code-audit/:path*',
        destination: `${aiUrl}/api/v1/code-audit/:path*`,
      },
      {
        source: '/api/v1/code-audit',
        destination: `${aiUrl}/api/v1/code-audit`,
      },
      {
        source: '/api/v1/:path*',
        destination: `${coreUrl}/api/v1/:path*`,
      },
      {
        source: '/api/ai/:path*',
        destination: `${aiUrl}/api/ai/:path*`,
      },
      {
        source: '/api/rag/v1/:path*',
        destination: `${aiUrl}/api/v1/:path*`,
      },
      {
        source: '/api/obs/:path*',
        destination: `${obsUrl}/api/obs/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
