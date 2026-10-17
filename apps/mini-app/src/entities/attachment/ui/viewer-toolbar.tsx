import { Download, Maximize, Minus, Plus, X } from "lucide-react"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { ATTACHMENT_IDS } from "../config/test-ids"
import type { ViewerToolbarProps } from "../model/types/viewer-toolbar.types"

export type { ViewerToolbarProps } from "../model/types/viewer-toolbar.types"

export function ViewerToolbar({ name, percent, zoomIn, zoomOut, fit, original, download, close }: ViewerToolbarProps) {
  const { t } = useTranslation()

  return (
    <header className="viewer-toolbar" data-testid={ATTACHMENT_IDS.toolbar}>
      <span className="viewer-name" title={name}>
        {name}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
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
        data-testid={ATTACHMENT_IDS.close}
        onClick={close}
        aria-label={t("attachmentClose")}
        autoFocus
      >
        <X aria-hidden="true" size={22} />
      </Button>
      <nav className="viewer-controls" aria-label={t("imageNavigation")}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          data-testid={ATTACHMENT_IDS.zoomOut}
          onClick={zoomOut}
          aria-label={t("imageZoomOut")}
        >
          <Minus aria-hidden="true" size={20} />
        </Button>
        <output className="viewer-percentage" data-testid={ATTACHMENT_IDS.zoom} aria-label={t("imageZoom", { percent })}>
          {percent}%
        </output>
        <Button
          type="button"
          variant="ghost"
          size="icon"
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
