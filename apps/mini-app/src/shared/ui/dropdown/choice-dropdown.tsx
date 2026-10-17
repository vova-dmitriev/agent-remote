import * as Menu from "@radix-ui/react-dropdown-menu"
import { Check, ChevronDown } from "lucide-react"
import { Button } from "../button"
import { MenuContent } from "./menu-content"
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
}: ChoiceDropdownProps<Value>) {
  return (
    <div role="group" aria-label={label} data-testid={ids.root}>
      <Menu.Root modal={false}>
        <Menu.Trigger asChild>
          <Button
            type="button"
            variant="ghost"
            className={"preference-trigger" + (compactIcon ? " icon-preference" : "")}
            aria-label={label + ": " + triggerLabel}
            title={label + ": " + triggerLabel}
            data-testid={ids.trigger}
            data-value={value}
          >
            <Icon aria-hidden="true" size={15} />
            <span className="preference-label">{triggerLabel}</span>
            <ChevronDown aria-hidden="true" size={12} />
          </Button>
        </Menu.Trigger>
        <MenuContent data-testid={ids.panel}>
          <Menu.Label className="dropdown-label">{label}</Menu.Label>
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
                className="dropdown-item"
                data-testid={option.testId}
              >
                {option.icon ? <option.icon aria-hidden="true" size={17} /> : null}
                <span className="dropdown-description">
                  <span>{option.label}</span>
                  {option.description ? <small>{option.description}</small> : null}
                </span>
                <Menu.ItemIndicator className="dropdown-check">
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
