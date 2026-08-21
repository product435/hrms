import { useState, type ReactNode } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { SidebarNav } from "./SidebarNav";
import { Topbar } from "./Topbar";
import { useSession } from "@/hooks/useSession";

export function AppLayout({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { isAuthenticated, isLoading } = useSession();

  // Auth state is cleared synchronously on sign-out. Stop rendering protected
  // content in that same render so the previous user's page cannot flash while
  // the router transitions to /sign-in.
  if (!isLoading && !isAuthenticated) return null;

  return (
    <div className="flex min-h-screen w-full bg-background">
      <aside className="hidden w-[268px] shrink-0 border-r border-sidebar-border lg:block">
        <div className="fixed inset-y-0 left-0 w-[268px]">
          <SidebarNav />
        </div>
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-[280px] border-sidebar-border p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarNav onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenSidebar={() => setMobileOpen(true)} />
        <main className="mx-auto w-full max-w-[1600px] flex-1 space-y-6 px-3 py-5 sm:px-5 sm:py-6 lg:px-8 lg:py-8">
          {children}
        </main>
        <footer className="border-t border-border px-3 py-4 text-xs text-muted-foreground sm:px-5 lg:px-8" />
      </div>
    </div>
  );
}
