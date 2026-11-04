// Shared by the isolated snipping renderer and its geometry tests.
;(function (root) {
  function selection(input, width, height) {
    if (!Array.isArray(input) || input.length < 3 || input.length > 100000
      || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
    const points = []
    for (const point of input) {
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null
      const next = { x: Math.max(0, Math.min(width, point.x)), y: Math.max(0, Math.min(height, point.y)) }
      const last = points[points.length - 1]
      if (!last || last.x !== next.x || last.y !== next.y) points.push(next)
    }
    if (points.length < 3) return null
    let left = width, top = height, right = 0, bottom = 0, area = 0
    points.forEach((point, index) => {
      left = Math.min(left, point.x); top = Math.min(top, point.y)
      right = Math.max(right, point.x); bottom = Math.max(bottom, point.y)
      const next = points[(index + 1) % points.length]
      area += point.x * next.y - next.x * point.y
    })
    if (right - left < 5 || bottom - top < 5 || Math.abs(area) / 2 < 25) return null
    return { points, bounds: { x: left, y: top, width: right - left, height: bottom - top } }
  }

  function trace(context, points, scaleX = 1, scaleY = 1, offsetX = 0, offsetY = 0, closed = true) {
    context.beginPath()
    points.forEach((point, index) => {
      context[index ? 'lineTo' : 'moveTo'](point.x * scaleX - offsetX, point.y * scaleY - offsetY)
    })
    if (closed) context.closePath()
  }

  function crop(image, input, width, height, createCanvas = () => document.createElement('canvas')) {
    const region = selection(input, width, height)
    const imageWidth = image.naturalWidth || image.width, imageHeight = image.naturalHeight || image.height
    if (!region || !Number.isFinite(imageWidth) || !Number.isFinite(imageHeight) || imageWidth <= 0 || imageHeight <= 0) return null
    const scaleX = imageWidth / width, scaleY = imageHeight / height
    const left = Math.floor(region.bounds.x * scaleX), top = Math.floor(region.bounds.y * scaleY)
    const right = Math.min(imageWidth, Math.ceil((region.bounds.x + region.bounds.width) * scaleX))
    const bottom = Math.min(imageHeight, Math.ceil((region.bounds.y + region.bounds.height) * scaleY))
    const output = createCanvas()
    output.width = right - left; output.height = bottom - top
    const context = output.getContext('2d')
    // Paint the outside of the selection, rather than merely cropping its
    // bounding box: surrounding screen contents must not survive in the PNG.
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, output.width, output.height)
    context.save()
    trace(context, region.points, scaleX, scaleY, left, top)
    context.clip('evenodd')
    context.drawImage(image, -left, -top)
    context.restore()
    return output
  }

  const api = { selection, trace, crop }
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.PeepNoteLasso = api
})(typeof window === 'undefined' ? globalThis : window)
