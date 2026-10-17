import { expect, it } from "vitest"
import { clampTransform, fitScale, zoomAt } from "../src/entities/attachment/lib/image-transform"

it("fits large images without enlarging small originals", () => {
  expect(fitScale({ width: 2400, height: 1600 }, { width: 400, height: 600 })).toBeCloseTo(1 / 6)
  expect(fitScale({ width: 100, height: 50 }, { width: 400, height: 600 })).toBe(1)
})

it("keeps the image point beneath the zoom focal point and clamps pan to image bounds", () => {
  const image = { width: 2400, height: 1600 },
    viewport = { width: 400, height: 600 }

  const next = zoomAt({ scale: 0.5, x: 0, y: 0 }, 1, { x: 100, y: 60 }, image, viewport)

  expect(next).toEqual({ scale: 1, x: -100, y: -60 })
  expect(clampTransform({ scale: 1, x: 99999, y: -99999 }, image, viewport)).toEqual({ scale: 1, x: 1000, y: -500 })
  expect(clampTransform({ scale: 1 / 6, x: 80, y: 80 }, image, viewport)).toEqual({ scale: 1 / 6, x: 0, y: 0 })
})
