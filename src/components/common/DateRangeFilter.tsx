import { useState } from "react";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { indiaDateKey } from "@/lib/format";

export type DateRange = { from: string; to: string };

function ddmmyyyy(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}-${month}-${year}`;
}

function SingleDateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (date: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? new Date(`${value}T00:00:00`) : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="h-10 w-full justify-start gap-2 font-normal sm:w-[160px]"
        >
          <CalendarIcon className="size-4" />
          {value ? ddmmyyyy(value) : label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          captionLayout="dropdown"
          selected={selected}
          defaultMonth={selected ?? new Date()}
          onSelect={(date) => {
            if (!date) return;
            onChange(indiaDateKey(date));
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Two always-visible From/To date fields (dd-mm-yyyy) with Apply/Clear. The
 * list is only re-filtered when `onApply` fires, never while picking a date
 * -- the caller owns the applied `DateRange` and only updates it from
 * `onApply`/`onClear`.
 */
export function DateRangeFilter({
  from,
  to,
  onApply,
  onClear,
}: {
  from: string;
  to: string;
  onApply: (from: string, to: string) => void;
  onClear: () => void;
}) {
  const [pendingFrom, setPendingFrom] = useState(from);
  const [pendingTo, setPendingTo] = useState(to);
  const invalid = pendingFrom !== "" && pendingTo !== "" && pendingFrom > pendingTo;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <SingleDateField label="From" value={pendingFrom} onChange={setPendingFrom} />
        <SingleDateField label="To" value={pendingTo} onChange={setPendingTo} />
        <Button
          type="button"
          size="sm"
          className="h-10"
          disabled={invalid}
          onClick={() => onApply(pendingFrom, pendingTo)}
        >
          Apply
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-10"
          onClick={() => {
            setPendingFrom("");
            setPendingTo("");
            onClear();
          }}
        >
          Clear
        </Button>
      </div>
      {invalid ? (
        <p className="text-xs text-destructive">"From" cannot be later than "To".</p>
      ) : null}
    </div>
  );
}
