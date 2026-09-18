import type { ImageProcessingProvider } from '../services/image.service'

export type PhotoroomOptions = {
  apiKey: string
  endpoint?: string
}

/** Server-only image processor adapter; the API key is never part of a DTO. */
export class PhotoroomImageProcessingProvider implements ImageProcessingProvider {
  private readonly endpoint: string
  constructor(private readonly options: PhotoroomOptions) {
    this.endpoint = options.endpoint ?? 'https://sdk.photoroom.com/v1/segment'
  }

  async process(input: { body: ArrayBuffer; mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; signal?: AbortSignal }): Promise<ArrayBuffer> {
    const form = new FormData()
    form.append('image_file', new Blob([input.body], { type: input.mimeType }), 'product-image')
    form.append('bg_color', 'FFFFFF')
    form.append('size', '1200x1200')
    form.append('padding', '12%')
    const response = await fetch(this.endpoint, { method: 'POST', headers: { 'x-api-key': this.options.apiKey, Accept: 'image/webp' }, body: form, signal: input.signal })
    if (!response.ok) throw new Error(`image processor status ${response.status}`)
    return response.arrayBuffer()
  }
}

