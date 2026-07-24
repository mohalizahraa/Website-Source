import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/Toast";

export const metadata: Metadata = {
  title: "Miʿrāj — Haydari Translation Workbench",
  description:
    "Review-driven translation workbench for the Haydari corpus: confidence triage, tracked-changes editing, and model teaching.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FCFBF5" },
    { media: "(prefers-color-scheme: dark)", color: "#12140E" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
