import { Button } from "@/shared/ui/button"
import { cn } from "@/shared/lib/utils"
import { SlashSkillRole } from "@/features/send-command/config/slash-skills"
import { SLASH_SKILL_IDS } from "@/features/send-command/config/slash-test-ids"
import type { SkillsMenuProps } from "../skills-menu.types"

export interface SkillOptionsProps {
  items: SkillsMenuProps["items"]
  active: number
  listId: string
  pick: SkillsMenuProps["pick"]
  highlight: SkillsMenuProps["highlight"]
}

export function SkillOptions({ items, active, listId, pick, highlight }: SkillOptionsProps) {
  return items.map((skill, index) => (
    <Button
      key={skill.invocation}
      id={`${listId}-${index}`}
      type="button"
      role={SlashSkillRole.Option}
      aria-selected={index === active}
      variant="ghost"
      className={cn(
        "flex h-auto w-full flex-col items-start gap-0.5 whitespace-normal rounded-lg px-2.5 py-2 text-left",
        index === active && "bg-accent text-accent-foreground",
      )}
      data-testid={SLASH_SKILL_IDS.option}
      data-invocation={skill.invocation}
      onMouseDown={(event) => event.preventDefault()}
      onMouseMove={() => highlight(index)}
      onClick={() => pick(skill)}
    >
      <span className="break-all font-mono text-[13px] font-medium leading-5">{skill.invocation}</span>
      <span className="line-clamp-2 break-words text-[11px] leading-4 text-muted-foreground">{skill.description}</span>
    </Button>
  ))
}
