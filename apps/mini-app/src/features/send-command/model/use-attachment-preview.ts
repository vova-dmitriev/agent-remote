import { useEffect, useState } from "react"

export function useAttachmentPreview(file: File, fixture: string) {
  const [preview, setPreview] = useState("")

  useEffect(() => {
    if (fixture || !/^image\/(png|jpeg|gif|webp)$/u.test(file.type)) return
    const url = URL.createObjectURL(file)

    setPreview(url)

    return () => URL.revokeObjectURL(url)
  }, [file, fixture])

  return fixture || preview
}
