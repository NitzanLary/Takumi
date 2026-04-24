"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { ChatDrawer } from "@/components/ai/ChatDrawer";
import { FloatingChatBar } from "@/components/ai/FloatingChatBar";
import { OnboardingModal } from "@/components/profile/OnboardingModal";

const AUTH_PATHS = new Set([
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
]);

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuthPage = AUTH_PATHS.has(pathname);

  if (isAuthPage) {
    return <main className="min-h-screen bg-gray-50">{children}</main>;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar />
        {/* pb-28 leaves room for the floating AI bar docked at the bottom */}
        <main className="flex-1 overflow-y-auto p-3 pb-28 sm:p-6 sm:pb-28">
          {children}
        </main>
      </div>
      <FloatingChatBar />
      <ChatDrawer />
      <OnboardingModal />
    </div>
  );
}
