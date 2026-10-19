import { createPortal } from "react-dom"
import { ATTACHMENT_IDS } from "../config/test-ids"
import { VIEWER_ZOOM_FACTOR } from "../config/viewer"
import { useImageTransform } from "../model/use-image-transform"
import { useImageGestures } from "../model/use-image-gestures"
import { useViewerDialog } from "../model/use-viewer-dialog"
import { ViewerToolbar } from "./viewer-toolbar"
import type { ImageViewerProps } from "../model/types/image-viewer.types"

export function ImageViewer({ url, name, close, download }: ImageViewerProps) {
  const dialog = useViewerDialog()
  const image = useImageTransform()
  const gestures = useImageGestures(image)
  const { scale, x, y } = image.transform

  return createPortal(
    <dialog
      ref={dialog}
      className="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none overflow-hidden overscroll-none rounded-none border-0 bg-background p-0 text-foreground backdrop:bg-background open:flex open:flex-col"
      data-testid={ATTACHMENT_IDS.dialog}
      aria-label={name}
      onCancel={close}
    >
      <ViewerToolbar
        name={name}
        percent={Math.round(scale * 100)}
        close={close}
        download={download}
        fit={image.fit}
        original={image.original}
        zoomIn={() => image.zoomBy(VIEWER_ZOOM_FACTOR)}
        zoomOut={() => image.zoomBy(1 / VIEWER_ZOOM_FACTOR)}
      />
      <div
        ref={image.stage}
        className="relative mb-[env(safe-area-inset-bottom)] min-h-0 flex-1 cursor-grab touch-none overflow-hidden overscroll-none select-none active:cursor-grabbing"
        data-testid={ATTACHMENT_IDS.viewport}
        {...gestures}
      >
        <img
          src={url}
          alt={name}
          className="pointer-events-none absolute top-1/2 left-1/2 h-auto max-h-none w-auto max-w-none origin-center select-none"
          draggable={false}
          onLoad={image.loaded}
          style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${scale})` }}
          data-testid={ATTACHMENT_IDS.viewerImage}
          data-scale={scale}
          data-pan-x={x}
          data-pan-y={y}
        />
      </div>
    </dialog>,
    document.body,
  )
}
