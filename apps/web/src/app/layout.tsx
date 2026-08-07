import type { Metadata } from "next";
import "../styles/globals.css";

export const metadata: Metadata = {
  title: "LinkIQ — Intelligent Link Management",
  description:
    "Smart URL shortening, real-time analytics, and AI-powered insights for modern teams.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
