export type RecordingRegion = {
  sourceId: string
  x: number
  y: number
  width: number
  height: number
  canvasWidth: number
  canvasHeight: number
}

export async function startRegionRecording(
  region: RecordingRegion,
  onStopped: (blob: Blob) => Promise<void> | void
) {
  const desktopStream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: region.sourceId } } as any
  })
  const video = document.createElement('video')
  video.srcObject = desktopStream
  video.muted = true
  video.playsInline = true
  try {
    await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve()
    video.onerror = () => reject(new Error('Unable to load the screen capture stream.'))
  })
  await video.play()

  // On Linux/Wayland the metadata event can fire before the desktop stream has
  // produced a real frame. Cropping at that point creates a 1×1 black canvas.
  await new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + 3000
    const waitForFrame = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        resolve()
      } else if (Date.now() >= deadline) {
        reject(new Error('The selected screen did not provide a video frame.'))
      } else {
        requestAnimationFrame(waitForFrame)
      }
    }
      waitForFrame()
    })
  } catch (error) {
    video.pause()
    video.srcObject = null
    desktopStream.getTracks().forEach(track => track.stop())
    throw error
  }

  const scaleX = video.videoWidth / region.canvasWidth
  const scaleY = video.videoHeight / region.canvasHeight
  const sourceX = Math.max(0, Math.round(region.x * scaleX))
  const sourceY = Math.max(0, Math.round(region.y * scaleY))
  const sourceWidth = Math.max(1, Math.min(video.videoWidth - sourceX, Math.round(region.width * scaleX)))
  const sourceHeight = Math.max(1, Math.min(video.videoHeight - sourceY, Math.round(region.height * scaleY)))
  const canvas = document.createElement('canvas')
  canvas.width = sourceWidth
  canvas.height = sourceHeight
  const context = canvas.getContext('2d')
  if (!context) {
    desktopStream.getTracks().forEach(track => track.stop())
    throw new Error('Unable to create a recording canvas.')
  }

  let frameId = 0
  const drawFrame = () => {
    context.drawImage(video, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight)
    frameId = requestAnimationFrame(drawFrame)
  }
  drawFrame()
  const canvasStream = canvas.captureStream(30)
  const recorder = new MediaRecorder(canvasStream, { mimeType: 'video/webm; codecs=vp9' })
  const chunks: Blob[] = []
  recorder.ondataavailable = event => chunks.push(event.data)
  recorder.onstop = async () => {
    cancelAnimationFrame(frameId)
    video.pause()
    video.srcObject = null
    desktopStream.getTracks().forEach(track => track.stop())
    canvasStream.getTracks().forEach(track => track.stop())
    await onStopped(new Blob(chunks, { type: 'video/webm' }))
  }
  recorder.start()
  return recorder
}
