export type ImageProcessingStatus = 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED'

export type ProductImageRecord = {
  id: string
  productId: string
  originalKey: string
  processedKey?: string
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
  byteSize: number
  processingStatus: ImageProcessingStatus
  approvedVariant?: 'original' | 'processed'
  errorCode?: string
  createdAt: string
  updatedAt: string
}

export type ImageStorage = {
  put: (key: string, body: ArrayBuffer | Uint8Array, options?: { contentType?: string }) => Promise<void>
  get?: (key: string) => Promise<ArrayBuffer | null>
}

export type ImageProcessingProvider = {
  process: (input: { body: ArrayBuffer; mimeType: ProductImageRecord['mimeType']; signal?: AbortSignal }) => Promise<ArrayBuffer>
}

export class ImageServiceError extends Error {
  constructor(public readonly code: 'IMAGE_INVALID' | 'IMAGE_TOO_LARGE' | 'IMAGE_STORAGE_FAILED' | 'IMAGE_PROCESSING_FAILED' | 'IMAGE_APPROVAL_INVALID', message: string) {
    super(message)
    this.name = 'ImageServiceError'
  }
}

const MAX_BYTES = 15 * 1024 * 1024
const MIME_TO_EXTENSION: Record<ProductImageRecord['mimeType'], string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

function id(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `image-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function asBytes(input: ArrayBuffer | Uint8Array | Blob): Promise<ArrayBuffer> {
  if (input instanceof Blob) return input.arrayBuffer()
  if (input instanceof Uint8Array) return Promise.resolve(input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer)
  return Promise.resolve(input)
}

function validMime(value: string): value is ProductImageRecord['mimeType'] {
  return value === 'image/jpeg' || value === 'image/png' || value === 'image/webp'
}

export async function processProductImage(options: {
  productId: string
  body: ArrayBuffer | Uint8Array | Blob
  mimeType: string
  storage: ImageStorage
  provider: ImageProcessingProvider
  now?: Date
}): Promise<ProductImageRecord> {
  if (!validMime(options.mimeType)) throw new ImageServiceError('IMAGE_INVALID', 'Solo se aceptan imágenes JPG, PNG o WEBP.')
  const body = await asBytes(options.body)
  if (body.byteLength <= 0) throw new ImageServiceError('IMAGE_INVALID', 'La imagen está vacía.')
  if (body.byteLength > MAX_BYTES) throw new ImageServiceError('IMAGE_TOO_LARGE', 'La imagen supera el límite de 15 MB.')
  const now = options.now ?? new Date()
  const imageId = id()
  const originalKey = `products/${options.productId}/original/${imageId}.${MIME_TO_EXTENSION[options.mimeType]}`
  const processedKey = `products/${options.productId}/processed/${imageId}.webp`
  try {
    await options.storage.put(originalKey, body, { contentType: options.mimeType })
  } catch {
    throw new ImageServiceError('IMAGE_STORAGE_FAILED', 'No se pudo guardar la imagen original.')
  }
  const record: ProductImageRecord = { id: imageId, productId: options.productId, originalKey, processedKey, mimeType: options.mimeType, byteSize: body.byteLength, processingStatus: 'PROCESSING', createdAt: now.toISOString(), updatedAt: now.toISOString() }
  try {
    const processed = await options.provider.process({ body, mimeType: options.mimeType })
    if (processed.byteLength <= 0) throw new Error('empty processed image')
    await options.storage.put(processedKey, processed, { contentType: 'image/webp' })
    record.processingStatus = 'READY'
    record.updatedAt = new Date().toISOString()
  } catch {
    // Keep the original and mark the record retryable. The admin can approve
    // the original or retry processing without losing the upload.
    record.processingStatus = 'FAILED'
    record.errorCode = 'PROCESSING_FAILED'
    record.updatedAt = new Date().toISOString()
  }
  return record
}

/** Re-run the processor against the immutable original kept in media storage.
 * A failed retry never removes the original or an already-produced derivative.
 */
export async function retryProductImage(options: {
  record: ProductImageRecord
  storage: ImageStorage
  provider: ImageProcessingProvider
  now?: Date
}): Promise<ProductImageRecord> {
  if (!options.storage.get) throw new ImageServiceError('IMAGE_STORAGE_FAILED', 'No se puede leer la imagen original.')
  let body: ArrayBuffer | null
  try {
    body = await options.storage.get(options.record.originalKey)
  } catch {
    throw new ImageServiceError('IMAGE_STORAGE_FAILED', 'No se pudo leer la imagen original.')
  }
  if (!body || body.byteLength <= 0) throw new ImageServiceError('IMAGE_STORAGE_FAILED', 'La imagen original ya no está disponible.')

  const now = options.now ?? new Date()
  const record = options.record
  record.processingStatus = 'PROCESSING'
  delete record.approvedVariant
  delete record.errorCode
  record.updatedAt = now.toISOString()
  try {
    const processed = await options.provider.process({ body, mimeType: record.mimeType })
    if (processed.byteLength <= 0) throw new Error('empty processed image')
    if (processed.byteLength > MAX_BYTES) throw new Error('processed image too large')
    if (!record.processedKey) record.processedKey = `products/${record.productId}/processed/${record.id}.webp`
    await options.storage.put(record.processedKey, processed, { contentType: 'image/webp' })
    record.processingStatus = 'READY'
    record.updatedAt = new Date().toISOString()
  } catch {
    record.processingStatus = 'FAILED'
    record.errorCode = 'PROCESSING_FAILED'
    record.updatedAt = new Date().toISOString()
  }
  return record
}

export function approveImage(record: ProductImageRecord, variant: 'original' | 'processed'): ProductImageRecord {
  if (variant === 'processed' && record.processingStatus !== 'READY') throw new ImageServiceError('IMAGE_APPROVAL_INVALID', 'La imagen procesada todavía no está lista.')
  // v1 stores approval as a boolean. Dropping the derivative key when the
  // operator chooses the original preserves that choice across hydration
  // without exposing a private storage key or requiring a destructive delete.
  if (variant === 'original') delete record.processedKey
  record.approvedVariant = variant
  record.updatedAt = new Date().toISOString()
  return record
}
