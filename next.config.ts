import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  // Removes the "X-Powered-By: Next.js" response header -- a small
  // information-disclosure fix (framework fingerprinting), part of the
  // same security-headers pass as middleware.ts's CSP/frame/referrer
  // headers (which next.config.js's own `headers()` can't express, since
  // this app needs a per-request CSP nonce that only middleware can mint).
  poweredByHeader: false,
  images: {
    // All admin-uploaded content (menu item photos, landing hero images)
    // is served from this Supabase project's public Storage buckets —
    // next/image requires external hostnames explicitly allow-listed.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "qhiypdqnrnzndxdwqxbx.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
};

export default withNextIntl(nextConfig);
