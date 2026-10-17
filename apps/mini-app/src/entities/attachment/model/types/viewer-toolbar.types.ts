export interface ViewerToolbarProps {
  name: string
  percent: number
  zoomIn: () => void
  zoomOut: () => void
  fit: () => void
  original: () => void
  download: () => void
  close: () => void
}
