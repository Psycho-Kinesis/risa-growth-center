/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["pg"],
  // Ship the SQL and seed files with the setup API so the app can initialise its own database.
  outputFileTracingIncludes: {
    "/api/admin/setup": ["./db/**/*", "./data/seed/**/*"],
  },
};
export default nextConfig;
