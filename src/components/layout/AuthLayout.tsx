import type { ReactNode } from "react";
import { Moon, Sun } from "lucide-react";
import { Brand } from "./Brand";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/useTheme";

export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-background">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute right-3 top-3 z-10 sm:right-5 sm:top-5"
        onClick={toggleTheme}
        aria-label={theme === "dark" ? "Use light theme" : "Use dark theme"}
      >
        {theme === "dark" ? <Sun className="size-5" /> : <Moon className="size-5" />}
      </Button>
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="gradient-hero absolute -left-24 top-0 size-72 rounded-full opacity-15 blur-3xl" />
        <div className="absolute -right-16 bottom-0 size-96 rounded-full bg-primary/10 blur-3xl" />
      </div>

      <div className="relative mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-8 animate-in fade-in duration-500 ease-out sm:py-10">
        <div className="animate-in fade-in slide-in-from-bottom-2 mb-7 flex justify-center transition-transform duration-500 hover:scale-[1.02] sm:mb-8">
          <Brand />
        </div>

        <div className="animate-in fade-in slide-in-from-bottom-3 rounded-3xl border border-border/80 bg-card/95 p-5 shadow-float backdrop-blur-sm transition-shadow duration-300 hover:shadow-float sm:p-8">
          <div className="mb-6 text-center">
            <h1 className="font-display text-2xl font-bold tracking-tight">{title}</h1>
            {subtitle ? <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p> : null}
          </div>
          {children}
        </div>

        {footer ? (
          <div className="mt-6 text-center text-sm text-muted-foreground">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}
