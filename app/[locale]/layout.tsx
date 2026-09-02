import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { Be_Vietnam_Pro, Playfair_Display } from "next/font/google";
import { routing } from "@/i18n/routing";
import { HeaderActionsStack } from "@/components/shared/header-actions-stack";
import { ThemeProvider } from "@/hooks/useTheme";
import { TablesProvider } from "@/hooks/useTables";
import { CartProvider } from "@/hooks/useCart";
import { OrdersProvider } from "@/hooks/useOrders";
import { createClient } from "@/lib/supabase/server";
import { getCurrentRole } from "@/lib/get-current-role";
import "../globals.css";

const beVietnamPro = Be_Vietnam_Pro({
  variable: "--font-sans",
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700"],
});

const playfairDisplay = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin", "vietnamese"],
  style: ["normal", "italic"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "PhaDinCafe",
  description: "Order ahead, track your order, and earn loyalty points.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "PhaDinCafe",
  },
  other: {
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  themeColor: "#b3341f",
  // Without this, mobile browsers keep the layout viewport full-size when the
  // on-screen keyboard opens (default overlays-content) — any h-dvh/fixed
  // positioning (BottomSheet, the KDS/admin h-dvh shells) can't shrink to
  // stay above the keyboard, since there's nothing to recalculate against.
  interactiveWidget: "resizes-content",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  setRequestLocale(locale);
  const messages = await getMessages();
  const supabase = await createClient();
  const role = await getCurrentRole(supabase);
  // Set by middleware.ts's CSP nonce generation -- required so this one
  // inline script is allowed under a strict `script-src 'nonce-...'` CSP.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html
      lang={locale}
      className={`${beVietnamPro.variable} ${playfairDisplay.variable} h-full antialiased`}
      // The inline no-flash script below adds/removes the "dark" class
      // before React hydrates, based on localStorage/matchMedia -- info
      // the server render can't know. That's an intentional, one-level
      // deep divergence between server and client markup on this exact
      // element; suppress only its warning rather than papering over any
      // other real mismatch (see hooks/useTheme.tsx for the matching fix
      // to ThemeProvider's initial state).
      suppressHydrationWarning
    >
      <head>
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("phadincafe-theme");var d=t?t==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;if(d)document.documentElement.classList.add("dark");}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          <NextIntlClientProvider locale={locale} messages={messages}>
            <TablesProvider>
              <CartProvider>
                <OrdersProvider>
                  <HeaderActionsStack role={role} />
                  {children}
                </OrdersProvider>
              </CartProvider>
            </TablesProvider>
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
