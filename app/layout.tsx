import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { headers } from "next/headers";
import { APP_BASE_PATH } from "@/lib/app-config";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-600.css";
import "./globals.css";

const panshiDisplay = localFont({
  src: "../public/fonts/panshi-display.woff2",
  variable: "--font-panshi-display",
  display: "swap",
  weight: "200 900",
  fallback: ["Noto Serif TC", "Songti TC", "PMingLiU", "serif"],
});

export async function generateMetadata(): Promise<Metadata> {
  const incoming = await headers();
  const rawHost = incoming.get("x-forwarded-host") || incoming.get("host") || "localhost:3000";
  const host = /^[a-z0-9.:[\]-]+$/i.test(rawHost) ? rawHost : "localhost:3000";
  const protocol = incoming.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
  const configuredOrigin = process.env.SITE_URL?.trim().replace(/\/$/, "");
  const origin = configuredOrigin || `${protocol}://${host}${APP_BASE_PATH}`;
  const imageUrl = `${origin}/og.jpg`;

  return {
    title: {
      default: "盤勢 · 企業命盤 × 股價時間線",
      template: "%s · 盤勢",
    },
    description:
      "用公司日期建立命盤基準，將主要行運對齊臺股歷史收盤價。歷史重合不等於因果，不構成投資建議。",
    applicationName: "盤勢",
    creator: "盤勢",
    alternates: {
      canonical: origin,
    },
    openGraph: {
      type: "website",
      locale: "zh_TW",
      siteName: "盤勢",
      url: origin,
      title: "盤勢 · 把公司的時間，放回股價裡看",
      description: "企業命盤 × 股價時間線的文化研究與資料探索工具。",
      images: [{ url: imageUrl, width: 1672, height: 941, alt: "盤勢：企業命盤與股價時間線" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "盤勢 · 企業命盤 × 股價時間線",
      description: "把公司的時間，放回股價裡看。",
      images: [imageUrl],
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f4f0e8",
  colorScheme: "light",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant" className={panshiDisplay.variable}>
      <body>{children}</body>
    </html>
  );
}
