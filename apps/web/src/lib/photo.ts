/** Staff photos are Beverly's own (the same picture the wallet and CRM show). The API relays them; the version changes when the photo does. */
export const photoSrc = (agentId: string, version: string | null | undefined): string => (version ? `/api/agents/${encodeURIComponent(agentId)}/photo?v=${version}` : '')

/** Shrink a chosen image to a JPEG of at most `max` pixels on the long side, so uploads stay small and fast. */
export async function shrinkImage(file: File, max = 512): Promise<{ contentType: 'image/jpeg'; data: string }> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file')
  if (file.size > 12_000_000) throw new Error('Choose an image under 12 MB')
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const w = Math.max(1, Math.round(bmp.width * scale))
  const h = Math.max(1, Math.round(bmp.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser cannot prepare the image')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(bmp, 0, 0, w, h)
  bmp.close()
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.85))
  if (!blob) throw new Error('The image could not be prepared')
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return { contentType: 'image/jpeg', data: btoa(bin) }
}
