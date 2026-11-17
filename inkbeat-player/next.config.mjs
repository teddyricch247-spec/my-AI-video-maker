/** @type {import('next').NextConfig} */
const nextConfig = {
  // WebGL contexts are heavy: do not mount everything twice in dev
  reactStrictMode: false,
  transpilePackages: ["three"],
  // a stray type error in a generated scene must never stop the video from building
  typescript: { ignoreBuildErrors: true },
};
export default nextConfig;
