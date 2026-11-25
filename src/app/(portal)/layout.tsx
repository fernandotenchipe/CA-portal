import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { PortalAuthProvider } from "@/components/portal-auth";

export default function PortalLayout({ children }: { children: ReactNode }) {
  return <PortalAuthProvider><AppShell>{children}</AppShell></PortalAuthProvider>;
}
