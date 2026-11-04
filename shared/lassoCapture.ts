export interface LassoCaptureSelection {
  points: { x: number; y: number }[]
  width: number
  height: number
}

export function parseLassoCapture(value: unknown, width: number, height: number): LassoCaptureSelection | null {
  if (!value || typeof value !== 'object' || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  const input = value as Partial<LassoCaptureSelection>
  // Frameless Electron windows can report a one-pixel content-size difference
  // from the renderer on Linux. Reject real mismatches, not native rounding.
  if (!Number.isInteger(input.width) || !Number.isInteger(input.height)
    || input.width! <= 0 || input.height! <= 0
    || Math.abs(input.width! - width) > 2 || Math.abs(input.height! - height) > 2 || !Array.isArray(input.points)
    || input.points.length < 3 || input.points.length > 8192) return null
  if (input.points.some(point => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)
    || point.x < 0 || point.y < 0 || point.x > input.width! || point.y > input.height!)) return null
  return { width: input.width!, height: input.height!, points: input.points.map(({ x, y }) => ({ x, y })) }
}
