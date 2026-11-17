import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Carrocerías Aguirre",
  description: "Sistema interno de Carrocerías Aguirre.",
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
