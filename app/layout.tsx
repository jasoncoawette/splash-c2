import type { Metadata } from "next";
import { Geist } from "next/font/google";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import "mapbox-gl/dist/mapbox-gl.css";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  display: "swap",
});

const chakraPetch = localFont({
  variable: "--font-chakra-petch",
  display: "swap",
  src: [
    {
      path: "../public/ChakraPetch-Regular.ttf",
      weight: "400",
      style: "normal",
    },
    {
      path: "../public/ChakraPetch-Medium.ttf",
      weight: "500",
      style: "normal",
    },
    {
      path: "../public/ChakraPetch-SemiBold.ttf",
      weight: "600",
      style: "normal",
    },
    {
      path: "../public/ChakraPetch-Bold.ttf",
      weight: "700",
      style: "normal",
    },
  ],
});

export const metadata: Metadata = {
  title: "Splash C2 — Fleet Command",
  description: "Autonomous surface fleet command by COET Systems",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geist.variable} ${chakraPetch.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
