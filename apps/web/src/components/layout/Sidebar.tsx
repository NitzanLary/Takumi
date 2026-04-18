"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { useUiStore } from "@/stores/ui-store";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: "📊" },
  { href: "/positions", label: "Positions", icon: "💼" },
  { href: "/history", label: "Trade History", icon: "📋" },
  { href: "/analytics", label: "Analytics", icon: "📈" },
  { href: "/import", label: "Import", icon: "📥" },
  { href: "/alerts", label: "Alerts", icon: "🔔" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
];

export function Sidebar() {
  const pathname = usePathname();
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const closeSidebar = useUiStore((s) => s.closeSidebar);

  // Auto-close mobile drawer on route change
  useEffect(() => {
    closeSidebar();
  }, [pathname, closeSidebar]);

  const navContent = (
    <>
      <div className="flex h-14 items-center justify-between border-b border-gray-200 px-5">
        <h1 className="text-xl font-bold text-gray-900">Takumi</h1>
        <button
          onClick={closeSidebar}
          className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 md:hidden"
          title="Close menu"
          aria-label="Close menu"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-5 w-5"
          >
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        </button>
      </div>
      <nav className="flex-1 space-y-1 px-3 py-4">
        {navItems.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-blue-50 text-blue-700"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              }`}
            >
              <span>{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
    </>
  );

  return (
    <>
      {/* Desktop sidebar — always visible on md+ */}
      <aside className="hidden w-60 flex-col border-r border-gray-200 bg-white md:flex">
        {navContent}
      </aside>

      {/* Mobile drawer — off-canvas, toggled by ui-store */}
      {sidebarOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/30 md:hidden"
            onClick={closeSidebar}
            aria-hidden="true"
          />
          <aside className="fixed bottom-0 left-0 top-0 z-50 flex w-64 flex-col border-r border-gray-200 bg-white shadow-xl md:hidden">
            {navContent}
          </aside>
        </>
      )}
    </>
  );
}
