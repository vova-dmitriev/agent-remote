import { Check } from "lucide-react"
import { Button } from "@/shared/ui/button"
import { cn } from "@/shared/lib/utils"
import type { ChoiceListProps } from "./model-dialog.types"

/** One labelled group of choices, the current one checked; picking another one calls `onPick`. */
export function ChoiceList({ label, values, current, unavailable = [], disabled, testId, optionTestId, onPick }: ChoiceListProps) {
  const off = new Set(unavailable)

  return (
    <div className="mt-[14px]" role="radiogroup" aria-label={label} data-testid={testId}>
      <p className="mb-[4px] text-[12px] font-medium text-muted-foreground">{label}</p>
      {values.map((value) => (
        <Button
          key={value}
          type="button"
          variant="ghost"
          role="radio"
          aria-checked={value === current}
          disabled={disabled || off.has(value)}
          className={cn(
            "h-[40px] w-full justify-between rounded-[10px] px-[10px] text-[14px] font-normal",
            value === current && "bg-highlight",
          )}
          data-testid={optionTestId}
          data-value={value}
          onClick={() => {
            if (value !== current) onPick(value)
          }}
        >
          {value}
          {value === current ? <Check aria-hidden="true" size={16} /> : null}
        </Button>
      ))}
    </div>
  )
}
