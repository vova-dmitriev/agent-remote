export interface Size {
  width: number
  height: number
}
export interface Transform {
  scale: number
  x: number
  y: number
}
export interface Point {
  x: number
  y: number
}

export function fitScale(image: Size, viewport: Size) {
  return Math.min(viewport.width / image.width, viewport.height / image.height, 1)
}

export function clampTransform(transform: Transform, image: Size, viewport: Size): Transform {
  const limitX = Math.max(0, (image.width * transform.scale - viewport.width) / 2)
  const limitY = Math.max(0, (image.height * transform.scale - viewport.height) / 2)

  return { ...transform, x: Math.max(-limitX, Math.min(limitX, transform.x)), y: Math.max(-limitY, Math.min(limitY, transform.y)) }
}

export function zoomAt(transform: Transform, scale: number, point: Point, image: Size, viewport: Size) {
  const ratio = scale / transform.scale

  return clampTransform(
    { scale, x: point.x - (point.x - transform.x) * ratio, y: point.y - (point.y - transform.y) * ratio },
    image,
    viewport,
  )
}
