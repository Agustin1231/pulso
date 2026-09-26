import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { RegistroServiceWorker } from "@/components/pwa/registro-sw";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets:  ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets:  ["latin"],
});

export const metadata: Metadata = {
  title:       "Pulso — Tu salud cardiovascular",
  description: "Monitorea tu salud cardiovascular, descubre recetas saludables y mantén hábitos que cuidan tu corazón.",
  manifest:    "/manifest.json",
  appleWebApp: {
    capable:       true,
    statusBarStyle: "black-translucent",
    title:         "Pulso",
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor:    "#ff6b6b",
  width:         "device-width",
  initialScale:  1,
  maximumScale:  1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable}`}
    >
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
        <RegistroServiceWorker />
      </body>
    </html>
  );
}
