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
    // Include sixteen screen pixels around the whole outline, including sloped
    // edges. Scale the margin with the screenshot, not with physical pixels.
    const margin = 16
    const left = Math.max(0, Math.floor((region.bounds.x - margin) * scaleX))
    const top = Math.max(0, Math.floor((region.bounds.y - margin) * scaleY))
    const right = Math.min(imageWidth, Math.ceil((region.bounds.x + region.bounds.width + margin) * scaleX))
    const bottom = Math.min(imageHeight, Math.ceil((region.bounds.y + region.bounds.height + margin) * scaleY))
    const output = createCanvas()
    output.width = right - left; output.height = bottom - top
    const context = output.getContext('2d')
    // Dilate a closed polygon with a round stroke. A separate mask keeps real
    // screenshot content in that extra margin and leaves the rest white.
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, output.width, output.height)
    const mask = createCanvas()
    mask.width = output.width; mask.height = output.height
    const maskContext = mask.getContext('2d')
    maskContext.save()
    maskContext.scale(scaleX, scaleY)
    trace(maskContext, region.points, 1, 1, left / scaleX, top / scaleY)
    maskContext.fillStyle = '#ffffff'
    maskContext.strokeStyle = '#ffffff'
    maskContext.lineWidth = margin * 2
    maskContext.lineCap = 'round'
    maskContext.lineJoin = 'round'
    maskContext.fill('evenodd')
    maskContext.stroke()
    maskContext.restore()
    maskContext.globalCompositeOperation = 'source-in'
    maskContext.drawImage(image, -left, -top)
    context.drawImage(mask, 0, 0)
    return output
  }

  const api = { selection, trace, crop }
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.PeepNoteLasso = api
})(typeof window === 'undefined' ? globalThis : window)
