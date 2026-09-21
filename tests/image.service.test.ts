import { describe, expect, it } from 'vitest'
import { approveImage, ImageServiceError, processProductImage, reorderProductImages, retryProductImage, uploadProductImage, type ImageProcessingProvider, type ImageStorage } from '../src/worker/services/image.service'

function storage() {
  const objects = new Map<string, ArrayBuffer>()
  const adapter: ImageStorage = {
    put: async (key, body) => { objects.set(key, body instanceof Uint8Array ? body.slice().buffer : body.slice(0)) },
    get: async (key) => objects.get(key)?.slice(0) ?? null,
  }
  return { adapter, objects }
}

const okProvider: ImageProcessingProvider = { process: async () => new Uint8Array([1, 2, 3]).buffer }

describe('product image pipeline', () => {
  it('stores a normal upload as the approved original without invoking a processor', async () => {
    const target = storage()
    const record = await uploadProductImage({ productId: 'orbita-oscura', body: new Uint8Array([1, 2]), mimeType: 'image/png', sortOrder: 2, storage: target.adapter, now: new Date('2026-09-20T12:00:00.000Z') })

    expect(record.processingStatus).toBe('READY')
    expect(record.approvedVariant).toBe('original')
    expect(record.processedKey).toBeUndefined()
    expect(record.sortOrder).toBe(2)
    expect(target.objects.has(record.originalKey)).toBe(true)
  })

  it('reorders all product images into the requested positions', () => {
    const images = [
      { id: 'first', productId: 'p', originalKey: 'first', mimeType: 'image/jpeg' as const, byteSize: 1, processingStatus: 'READY' as const, approvedVariant: 'original' as const, sortOrder: 1, createdAt: '2026-09-20T10:00:00.000Z', updatedAt: '2026-09-20T10:00:00.000Z' },
      { id: 'second', productId: 'p', originalKey: 'second', mimeType: 'image/jpeg' as const, byteSize: 1, processingStatus: 'READY' as const, approvedVariant: 'original' as const, sortOrder: 2, createdAt: '2026-09-20T11:00:00.000Z', updatedAt: '2026-09-20T11:00:00.000Z' },
    ]

    expect(reorderProductImages(images, ['second', 'first']).map((image) => [image.id, image.sortOrder])).toEqual([['second', 1], ['first', 2]])
  })

  it('stores original before processing and returns a ready record', async () => {
    const target = storage()
    const record = await processProductImage({ productId: 'orbita-oscura', body: new Uint8Array([1, 2]), mimeType: 'image/jpeg', storage: target.adapter, provider: okProvider })
    expect(record.processingStatus).toBe('READY')
    expect(record.originalKey).toContain('/original/')
    expect(record.processedKey).toContain('/processed/')
    expect(target.objects.has(record.originalKey)).toBe(true)
    expect(target.objects.has(record.processedKey!)).toBe(true)
    expect(approveImage(record, 'processed').approvedVariant).toBe('processed')
  })

  it('keeps the original available when processing fails', async () => {
    const target = storage()
    const record = await processProductImage({ productId: 'orbita-oscura', body: new Uint8Array([1, 2]), mimeType: 'image/png', storage: target.adapter, provider: { process: async () => { throw new Error('provider down') } } })
    expect(record.processingStatus).toBe('FAILED')
    expect(target.objects.has(record.originalKey)).toBe(true)
    expect(() => approveImage(record, 'processed')).toThrowError(ImageServiceError)
    expect(approveImage(record, 'original').approvedVariant).toBe('original')
  })

  it('rejects unsupported and oversized inputs before touching storage', async () => {
    const target = storage()
    await expect(processProductImage({ productId: 'orbita-oscura', body: new Uint8Array([1]), mimeType: 'image/gif', storage: target.adapter, provider: okProvider })).rejects.toThrowError(/JPG/)
    await expect(processProductImage({ productId: 'orbita-oscura', body: new Uint8Array(15 * 1024 * 1024 + 1), mimeType: 'image/webp', storage: target.adapter, provider: okProvider })).rejects.toThrowError(/15 MB/)
    expect(target.objects.size).toBe(0)
  })

  it('retries from the stored original without losing it on failure', async () => {
    const target = storage()
    const record = await processProductImage({ productId: 'orbita-oscura', body: new Uint8Array([1, 2]), mimeType: 'image/png', storage: target.adapter, provider: { process: async () => { throw new Error('provider down') } } })
    const retry = await retryProductImage({ record, storage: target.adapter, provider: okProvider })
    expect(retry.processingStatus).toBe('READY')
    expect(target.objects.has(retry.originalKey)).toBe(true)
    expect(target.objects.has(retry.processedKey!)).toBe(true)
  })

  it('keeps an original approval explicit across persistence', async () => {
    const target = storage()
    const record = await processProductImage({ productId: 'orbita-oscura', body: new Uint8Array([1, 2]), mimeType: 'image/jpeg', storage: target.adapter, provider: okProvider })
    const approved = approveImage(record, 'original')
    expect(approved.approvedVariant).toBe('original')
    expect(approved.processedKey).toBeUndefined()
    expect(target.objects.has(approved.originalKey)).toBe(true)
  })
})
