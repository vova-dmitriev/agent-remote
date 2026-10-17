import { useContext, useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { AttachmentKind, ErrorCode, type AttachmentDescriptor } from "@protocol"
import { AttachmentContext } from "./access-context"

export function useAttachment(sessionId: string, attachment: AttachmentDescriptor) {
  const access = useContext(AttachmentContext)
  const [url, setUrl] = useState("")
  const [opened, setOpened] = useState(false)
  const downloading = useRef(false)

  const query = useQuery({
    queryKey: ["attachment", sessionId, attachment.id],
    queryFn: ({ signal }) => {
      if (!access) throw new Error(ErrorCode.ATTACHMENT_UNAVAILABLE)

      return access.download(sessionId, attachment.id, signal)
    },
    enabled: attachment.kind === AttachmentKind.Image,
    retry: false,
    gcTime: 0,
    staleTime: Infinity,
  })

  useEffect(() => {
    if (!query.data) return
    const objectUrl = URL.createObjectURL(query.data)

    setUrl(objectUrl)

    return () => URL.revokeObjectURL(objectUrl)
  }, [query.data])

  useEffect(() => {
    if (!url || !downloading.current) return
    downloading.current = false
    const anchor = document.createElement("a")

    anchor.href = url
    anchor.download = attachment.name
    anchor.click()
  }, [url, attachment.name])

  function download() {
    if (url) {
      const anchor = document.createElement("a")

      anchor.href = url
      anchor.download = attachment.name
      anchor.click()
    } else {
      downloading.current = true
      void query.refetch()
    }
  }

  return { url, opened, setOpened, download, loading: query.isFetching, error: query.error, retry: () => void query.refetch() }
}
