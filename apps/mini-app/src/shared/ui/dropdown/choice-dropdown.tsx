import * as Menu from "@radix-ui/react-dropdown-menu"
import { Check, ChevronDown } from "lucide-react"
import { cn } from "@/shared/lib/utils"
import { Button } from "../button"
import { MenuContent } from "./menu/menu-content"
import { menuItemClass } from "./menu/menu-item-class"
import type { ChoiceDropdownProps } from "./choice-dropdown.types"

export function ChoiceDropdown<Value extends string>({
  value,
  label,
  triggerLabel,
  icon: Icon,
  options,
  onChange,
  ids,
  compactIcon = false,
  compactChevron = false,
  className,
  labelClassName,
}: ChoiceDropdownProps<Value>) {
  return (
    <div role="group" aria-label={label} className={className} data-testid={ids.root}>
      <Menu.Root modal={false}>
        <Menu.Trigger asChild>
          <Button
            type="button"
            variant="ghost"
            className="h-[30px] gap-[6px] rounded-[10px] border border-border bg-surface px-[9px] py-0 has-[>svg]:px-[9px] text-[12px] font-medium text-foreground hover:bg-surface hover:text-foreground focus-visible:border-border data-[state=open]:border-primary dark:hover:bg-surface"
            aria-label={label + ": " + triggerLabel}
            title={label + ": " + triggerLabel}
            data-testid={ids.trigger}
            data-value={value}
          >
            <Icon aria-hidden="true" size={15} />
            <span className={cn(compactIcon && "phone:hidden", labelClassName)}>{triggerLabel}</span>
            <ChevronDown aria-hidden="true" size={12} className={cn(compactChevron && "phone:hidden")} />
          </Button>
        </Menu.Trigger>
        <MenuContent data-testid={ids.panel}>
          <Menu.Label className="px-[10px] pt-[5px] pb-[7px] text-[11px] font-medium text-muted-foreground">{label}</Menu.Label>
          <Menu.RadioGroup
            value={value}
            onValueChange={(next) => {
              const option = options.find((item) => item.value === next)

              if (option) onChange(option.value)
            }}
          >
            {options.map((option) => (
              <Menu.RadioItem
                key={option.value}
                value={option.value}
                textValue={option.label}
                className={menuItemClass}
                data-testid={option.testId}
              >
                {option.icon ? <option.icon aria-hidden="true" size={17} /> : null}
                <span className="grid min-w-0 flex-1 gap-[2px] whitespace-normal wrap-anywhere">
                  <span>{option.label}</span>
                  {option.description ? (
                    <small className="text-[11px] leading-[15px] text-muted-foreground">{option.description}</small>
                  ) : null}
                </span>
                <Menu.ItemIndicator className="ml-auto flex flex-none text-primary">
                  <Check aria-hidden="true" size={16} />
                </Menu.ItemIndicator>
              </Menu.RadioItem>
            ))}
          </Menu.RadioGroup>
        </MenuContent>
      </Menu.Root>
    </div>
  )
}
