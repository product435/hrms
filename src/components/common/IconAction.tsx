import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type IconActionProps = {
  label: string;
  children: ReactNode;
  onClick?: ComponentProps<typeof Button>["onClick"];
  variant?: ComponentProps<typeof Button>["variant"];
  disabled?: boolean;
  type?: ComponentProps<typeof Button>["type"];
  className?: string;
};

export function IconAction({
  label,
  children,
  onClick,
  variant = "ghost",
  disabled = false,
  type = "button",
  className,
}: IconActionProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type={type}
          variant={variant}
          size="icon"
          disabled={disabled}
          onClick={onClick}
          aria-label={label}
          className={cn("size-8", className)}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
