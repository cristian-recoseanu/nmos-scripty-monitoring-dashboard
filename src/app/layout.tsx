import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NMOS System Monitoring Dashboard",
  description:
    "IS-04 / BCP-008 monitoring dashboard with traffic-light system view",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
