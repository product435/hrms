import { forwardRef, type ComponentProps } from "react";
import { Input } from "@/components/ui/input";
import { digitsOnly } from "@/lib/onboarding-schema";

export const MobileInput = forwardRef<HTMLInputElement, ComponentProps<typeof Input>>(
  function MobileInput({ onChange, ...props }, ref) {
    return (
      <Input
        ref={ref}
        type="text"
        autoComplete="tel"
        {...props}
        inputMode="numeric"
        maxLength={10}
        onChange={(event) => {
          event.target.value = digitsOnly(event.target.value).slice(0, 10);
          onChange?.(event);
        }}
      />
    );
  },
);
