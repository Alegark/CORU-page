import type { ImageStorage } from '../services/image.service'

export type R2BucketLike = {
  put: (key: string, value: ArrayBuffer | Uint8Array, options?: { httpMetadata?: { contentType?: string } }) => Promise<unknown>
  get?: (key: string) => Promise<{ arrayBuffer: () => Promise<ArrayBuffer> } | null>
}

/** Thin adapter that keeps Cloudflare R2 details out of image domain code. */
export class R2MediaStore implements ImageStorage {
  constructor(private readonly bucket: R2BucketLike) {}

  async put(key: string, body: ArrayBuffer | Uint8Array, options?: { contentType?: string }): Promise<void> {
    await this.bucket.put(key, body, options?.contentType ? { httpMetadata: { contentType: options.contentType } } : undefined)
  }

  async get(key: string): Promise<ArrayBuffer | null> {
    if (!this.bucket.get) return null
    const object = await this.bucket.get(key)
    return object ? object.arrayBuffer() : null
  }
}

/** Local/test implementation used when no R2 binding is configured. */
export class MemoryMediaStore implements ImageStorage {
  constructor(private readonly objects = new Map<string, ArrayBuffer>()) {}

  async put(key: string, body: ArrayBuffer | Uint8Array): Promise<void> {
    const copy = body instanceof Uint8Array ? body.slice().buffer : body.slice(0)
    this.objects.set(key, copy)
  }

  async get(key: string): Promise<ArrayBuffer | null> {
    const body = this.objects.get(key)
    return body ? body.slice(0) : null
  }
}
