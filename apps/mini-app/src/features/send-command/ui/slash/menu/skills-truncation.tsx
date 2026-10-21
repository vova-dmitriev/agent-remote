import { useTranslation } from "@/shared/lib/hooks"

export interface SkillsTruncationProps {
  truncated: boolean
}

export function SkillsTruncation({ truncated }: SkillsTruncationProps) {
  const { t } = useTranslation()

  return truncated ? <p className="px-3 py-2 text-xs text-muted-foreground">{t("slashSkillsTruncated")}</p> : null
}
