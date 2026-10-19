import { Download, Maximize, Minus, Plus, X } from "lucide-react"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { ATTACHMENT_IDS } from "../config/test-ids"
import type { ViewerToolbarProps } from "../model/types/viewer-toolbar.types"

export type { ViewerToolbarProps } from "../model/types/viewer-toolbar.types"

export function ViewerToolbar({ name, percent, zoomIn, zoomOut, fit, original, download, close }: ViewerToolbarProps) {
  const { t } = useTranslation()

  return (
    <header
      className="z-[1] grid min-h-[36px] shrink-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center justify-between gap-[4px] border-b border-border bg-surface pt-[max(8px,env(safe-area-inset-top))] pr-[max(10px,env(safe-area-inset-right))] pb-[8px] pl-[max(10px,env(safe-area-inset-left))]"
      data-testid={ATTACHMENT_IDS.toolbar}
    >
      <span className="min-w-0 overflow-hidden text-[13px] text-ellipsis whitespace-nowrap" title={name}>
        {name}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={toolbarButtonClass}
        data-testid={ATTACHMENT_IDS.viewerDownload}
        onClick={download}
        aria-label={t("attachmentDownload", { name })}
      >
        <Download aria-hidden="true" size={20} />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={toolbarButtonClass}
        data-testid={ATTACHMENT_IDS.close}
        onClick={close}
        aria-label={t("attachmentClose")}
        autoFocus
      >
        <X aria-hidden="true" size={22} />
      </Button>
      <nav className="col-span-full flex items-center justify-center gap-[8px]" aria-label={t("imageNavigation")}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={toolbarButtonClass}
          data-testid={ATTACHMENT_IDS.zoomOut}
          onClick={zoomOut}
          aria-label={t("imageZoomOut")}
        >
          <Minus aria-hidden="true" size={20} />
        </Button>
        <output
          className="min-w-[4ch] text-center text-[13px] tabular-nums"
          data-testid={ATTACHMENT_IDS.zoom}
          aria-label={t("imageZoom", { percent })}
        >
          {percent}%
        </output>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={toolbarButtonClass}
          data-testid={ATTACHMENT_IDS.zoomIn}
          onClick={zoomIn}
          aria-label={t("imageZoomIn")}
        >
          <Plus aria-hidden="true" size={20} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={toolbarButtonClass}
          data-testid={ATTACHMENT_IDS.fit}
          onClick={fit}
          aria-label={t("imageFit")}
          title={t("imageFit")}
        >
          <Maximize aria-hidden="true" size={20} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={toolbarButtonClass}
          data-testid={ATTACHMENT_IDS.original}
          onClick={original}
          aria-label={t("imageOriginal")}
          title={t("imageOriginal")}
        >
          <span aria-hidden="true">1:1</span>
        </Button>
      </nav>
    </header>
  )
}

const toolbarButtonClass = "size-[44px] shrink-0"
