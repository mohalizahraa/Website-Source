import type { Metadata, Viewport } from "next";
// Self-hosted type — Digital Scriptorium: Fraunces (display/serif reading),
// Hanken Grotesk (UI), Amiri (classical Arabic naskh). No CDN, works offline.
import "@fontsource-variable/fraunces";
import "@fontsource-variable/hanken-grotesk";
import "@fontsource/amiri/400.css";
import "@fontsource/amiri/700.css";
import "./globals.css";
import { ToastProvider } from "@/components/Toast";
import { AuthProvider } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Miʿrāj — Haydari Translation Workbench",
  description:
    "Review-driven translation workbench for the Haydari corpus: confidence triage, tracked-changes editing, and model teaching.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FBF8F1" },
    { media: "(prefers-color-scheme: dark)", color: "#171410" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <ToastProvider>{children}</ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
