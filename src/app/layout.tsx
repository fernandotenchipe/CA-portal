import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "CA Portal | Carrocerías Aguirre",
    template: "%s | CA Portal",
  },
  description: "Portal interno de operación de Carrocerías Aguirre.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
