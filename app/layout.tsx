import "./globals.css";
import { Suspense } from "react";
import AppShell from "./components/AppShell";

export const metadata = {
  title: "CampusFest Growth Center",
  description: "Attendee growth command center: analytics, campaign & task management and an AI growth analyst.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Suspense fallback={<div className="loading">Loading…</div>}>
          <AppShell>{children}</AppShell>
        </Suspense>
      </body>
    </html>
  );
}
