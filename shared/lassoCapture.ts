export interface LassoCaptureSelection {
  points: { x: number; y: number }[]
  width: number
  height: number
}

export function parseLassoCapture(value: unknown, width: number, height: number): LassoCaptureSelection | null {
  if (!value || typeof value !== 'object' || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  const input = value as Partial<LassoCaptureSelection>
  if (input.width !== width || input.height !== height || !Array.isArray(input.points)
    || input.points.length < 3 || input.points.length > 8192) return null
  if (input.points.some(point => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)
    || point.x < 0 || point.y < 0 || point.x > width || point.y > height)) return null
  return { width, height, points: input.points.map(({ x, y }) => ({ x, y })) }
}
