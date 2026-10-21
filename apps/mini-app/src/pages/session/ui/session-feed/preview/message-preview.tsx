import { createPortal } from "react-dom"
import { SESSION_FEED_IDS } from "@/pages/session/config/test-ids"
import { useMessagePreviewPosition } from "@/pages/session/model/use-message-preview-position"
import type { MessagePreviewProps } from "./message-preview.types"
import { PreviewBody } from "./preview-body"

export function MessagePreview({ id, message, anchor, agent, keep, leave, open }: MessagePreviewProps) {
  const { root, position } = useMessagePreviewPosition(anchor)

  return createPortal(
    <div
      ref={root}
      id={id}
      role="tooltip"
      className="fixed z-50 max-h-[calc(100dvh_-_16px)] w-[min(320px,calc(100vw_-_16px))] overflow-hidden rounded-[10px] border border-border bg-surface px-[12px] py-[10px] text-foreground shadow-[0_6px_24px_color-mix(in_srgb,var(--foreground)_18%,transparent)]"
      data-testid={SESSION_FEED_IDS.preview}
      data-message-id={message.id}
      style={position}
      onPointerEnter={keep}
      onPointerLeave={leave}
      onPointerDown={(event) => event.preventDefault()}
    >
      {open ? (
        <button type="button" className="block w-full cursor-pointer text-left" data-testid={SESSION_FEED_IDS.previewOpen} onClick={open}>
          <PreviewBody message={message} agent={agent} />
        </button>
      ) : (
        <PreviewBody message={message} agent={agent} />
      )}
    </div>,
    document.body,
  )
}
