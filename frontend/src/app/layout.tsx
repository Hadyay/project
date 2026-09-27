import type { Metadata } from "next";
import { Cairo, Roboto } from "next/font/google";
import type { ReactNode } from "react";

import { ConfirmProvider } from "@/components/Confirm";
import { ToastProvider } from "@/components/Toast";
import { AuthProvider } from "@/lib/auth";
import { LangProvider } from "@/lib/i18n";
import { PrefsProvider } from "@/lib/prefs";
import { THEME_BOOT, ThemeProvider } from "@/lib/theme";
import "./globals.css";
import "./theme.css";
import "./print.css";

// Self-hosted by next/font at build time: the app renders in its own fonts on
// an office PC with no internet, instead of falling back to whatever Windows has.
// Cairo reads clearly in Arabic and English; Roboto carries the figures.
const cairo = Cairo({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-cairo",
  display: "swap",
});
const roboto = Roboto({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-roboto",
  display: "swap",
});

export const metadata: Metadata = {
  title: "نظام إدارة العقارات",
  description: "إدارة الأبنية والعقود والحسابات",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={`${cairo.variable} ${roboto.variable}`} suppressHydrationWarning>
      <head>
        {/* Theme and direction before the first paint: no white flash in dark mode. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>
        <ThemeProvider>
          <LangProvider>
            <AuthProvider>
              <PrefsProvider>
                <ToastProvider>
                  <ConfirmProvider>{children}</ConfirmProvider>
                </ToastProvider>
              </PrefsProvider>
            </AuthProvider>
          </LangProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
