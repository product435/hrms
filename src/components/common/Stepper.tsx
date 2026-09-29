import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface StepperStep {
  id: string;
  label: string;
  description?: string;
}

interface StepperProps {
  steps: StepperStep[];
  currentIndex: number;
  /** Called when a completed step is chosen. Upcoming steps stay disabled. */
  onStepSelect?: (index: number) => void;
  ariaLabel?: string;
  className?: string;
}

export function Stepper({
  steps,
  currentIndex,
  onStepSelect,
  ariaLabel = "Progress",
  className,
}: StepperProps) {
  const safeIndex = Math.min(Math.max(currentIndex, 0), Math.max(steps.length - 1, 0));

  return (
    <nav aria-label={ariaLabel} className={cn("w-full", className)}>
      <ol className="flex gap-2 overflow-x-auto pb-1">
        {steps.map((step, index) => {
          const isCurrent = index === safeIndex;
          const isDone = index < safeIndex;
          const canSelect = Boolean(onStepSelect) && isDone;
          const body = (
            <>
              <span
                aria-hidden
                className={cn(
                  "grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold",
                  isDone && "bg-primary text-primary-foreground",
                  isCurrent &&
                    "bg-primary text-primary-foreground ring-2 ring-ring ring-offset-2 ring-offset-background",
                  !isDone && !isCurrent && "bg-muted text-muted-foreground",
                )}
              >
                {isDone ? <Check className="size-3.5" /> : index + 1}
              </span>
              <span className="min-w-0 text-left">
                {isDone ? <span className="sr-only">Completed: </span> : null}
                <span
                  className={cn(
                    "block text-sm font-medium",
                    isCurrent ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {step.label}
                </span>
                {step.description ? (
                  <span className="block text-xs text-muted-foreground">{step.description}</span>
                ) : null}
              </span>
            </>
          );

          return (
            <li
              key={step.id}
              className="min-w-[8.5rem] flex-1"
              aria-current={isCurrent ? "step" : undefined}
            >
              {canSelect ? (
                <button
                  type="button"
                  onClick={() => onStepSelect?.(index)}
                  className="flex w-full items-start gap-2 rounded-lg px-1 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {body}
                </button>
              ) : (
                <div
                  className="flex items-start gap-2 px-1 py-1"
                  aria-disabled={!isCurrent && !isDone ? true : undefined}
                >
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
