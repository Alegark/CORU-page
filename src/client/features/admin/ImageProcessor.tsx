import { useEffect, useState, type ChangeEvent } from 'react'
import { ApiClientError, fetchAdminImages, reorderAdminImages, type AdminImageRecord } from '../../api/admin'

export type ImageUploadState = 'idle' | 'uploading' | 'ready' | 'failed'

type ImageProcessorProps = {
  productId?: string
  onUpload?: (file: File) => Promise<AdminImageRecord | void> | AdminImageRecord | void
  onChanged?: () => Promise<void> | void
  pendingFiles?: File[]
  onPendingFilesChange?: (files: File[]) => void
  disabled?: boolean
}

const IMAGE_HELP = 'Recomendado: 1200 × 1200 px · JPG, PNG o WEBP · máximo 15 MB'

function sortImages(images: AdminImageRecord[]): AdminImageRecord[] {
  return [...images].sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
}

function imageStatusCopy(record: AdminImageRecord): string {
  if (record.processingStatus === 'FAILED') return 'Imagen guardada; revisa este archivo.'
  if (record.processingStatus === 'PROCESSING' || record.processingStatus === 'PENDING') return 'Imagen anterior en proceso.'
  return 'Imagen original lista para mostrar.'
}

function PendingImagePreview({ file, index }: { file: File; index: number }) {
  const [src, setSrc] = useState('')

  useEffect(() => {
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return
    const objectUrl = URL.createObjectURL(file)
    setSrc(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [file])

  return src ? <img className="image-order-preview" src={src} alt={`Imagen ${index + 1} pendiente`} /> : <span className="image-order-preview image-order-placeholder" aria-hidden="true">{index + 1}</span>
}

export function ImageProcessor({ productId, onUpload, onChanged, pendingFiles = [], onPendingFilesChange, disabled = false }: ImageProcessorProps) {
  const [status, setStatus] = useState<ImageUploadState>('idle')
  const [message, setMessage] = useState('Las imágenes se guardan tal como las subes.')
  const [images, setImages] = useState<AdminImageRecord[]>([])
  const [busyImageId, setBusyImageId] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    if (!productId) return () => { active = false }
    fetchAdminImages(productId).then((loaded) => { if (active) setImages(sortImages(loaded)) }).catch(() => undefined)
    return () => { active = false }
  }, [productId])

  async function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.currentTarget.value = ''
    if (!files.length) return
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp']
    const invalidType = files.find((file) => !allowedTypes.includes(file.type))
    const oversized = files.find((file) => file.size > 15 * 1024 * 1024)
    if (invalidType) { setStatus('failed'); setMessage(`Formato no válido para ${invalidType.name}. Usa JPG, PNG o WEBP.`) }
    if (oversized) { setStatus('failed'); setMessage(`${oversized.name} supera el límite de 15 MB.`) }
    const validFiles = files.filter((file) => allowedTypes.includes(file.type) && file.size <= 15 * 1024 * 1024)
    if (!validFiles.length) return

    if (!productId) {
      onPendingFilesChange?.([...pendingFiles, ...validFiles])
      setStatus('ready')
      setMessage(`${validFiles.length} ${validFiles.length === 1 ? 'imagen lista' : 'imágenes listas'} para subir al guardar el producto.`)
      return
    }

    setStatus('uploading'); setMessage(`Guardando ${validFiles.length === 1 ? 'imagen' : `${validFiles.length} imágenes`} original…`)
    try {
      if (!onUpload) throw new Error('No se configuró la subida de imágenes.')
      const uploadedImages: AdminImageRecord[] = []
      for (const file of validFiles) {
        const uploaded = await onUpload(file)
        if (uploaded) uploadedImages.push(uploaded)
      }
      if (uploadedImages.length) setImages((current) => sortImages([...current, ...uploadedImages]))
      setStatus('ready'); setMessage(`${validFiles.length === 1 ? 'Imagen guardada' : 'Imágenes guardadas'} sin alterar. Puedes cambiar su posición abajo.`)
      await onChanged?.()
    } catch (error) {
      setStatus('failed'); setMessage(error instanceof ApiClientError ? `${error.message} (${error.code})` : error instanceof Error ? error.message : 'No se pudo guardar la imagen original.')
    }
  }

  async function move(imageId: string, direction: -1 | 1) {
    if (!productId || busyImageId) return
    const index = images.findIndex((image) => image.id === imageId)
    const targetIndex = index + direction
    if (index < 0 || targetIndex < 0 || targetIndex >= images.length) return
    const ids = images.map((image) => image.id)
    ;[ids[index], ids[targetIndex]] = [ids[targetIndex], ids[index]]
    setBusyImageId(imageId)
    try {
      const updated = await reorderAdminImages(productId, ids)
      setImages(sortImages(updated)); setMessage('Orden actualizado.')
      await onChanged?.()
    } catch (error) {
      setStatus('failed'); setMessage(error instanceof ApiClientError ? `${error.message} (${error.code})` : error instanceof Error ? error.message : 'No se pudo cambiar el orden.')
    } finally { setBusyImageId(null) }
  }

  const titleId = productId ? `image-processor-title-${productId}` : 'image-processor-title-new'
  return <section className={`image-processor image-${status}`} aria-labelledby={titleId}>
    <div>
      <span className="eyebrow">Galería del producto</span>
      <h2 id={titleId}>Sube tus imágenes tal como son.</h2>
      <p>{message}</p>
      <small>{IMAGE_HELP}</small>
    </div>
    <div className="image-processor-actions">
      <label className="button button-secondary">
        <span>{status === 'uploading' ? 'Guardando…' : productId ? 'Subir imagen' : 'Elegir imágenes'}</span>
        <input type="file" accept="image/jpeg,image/png,image/webp" multiple={!productId} onChange={handleChange} disabled={disabled || status === 'uploading' || Boolean(busyImageId)} />
      </label>
    </div>
    {pendingFiles.length > 0 && <ol className="image-order-list" aria-label="Imágenes pendientes del producto">
      {pendingFiles.map((file, index) => <li className="image-order-item" key={`${file.name}-${file.lastModified}-${index}`}>
        <PendingImagePreview file={file} index={index} />
        <div className="image-order-copy"><strong>Imagen {index + 1}</strong><small>{file.name}</small></div>
        <div className="image-order-actions"><button className="icon-button" type="button" onClick={() => onPendingFilesChange?.(pendingFiles.filter((_, fileIndex) => fileIndex !== index))} aria-label={`Quitar imagen ${index + 1}`} title="Quitar imagen">×</button></div>
      </li>)}
    </ol>}
    {productId && images.length > 0 && <ol className="image-order-list" aria-label="Orden de imágenes del producto">
      {images.map((image, index) => <li className="image-order-item" key={image.id}>
        <img className="image-order-preview" src={`/api/admin/products/${encodeURIComponent(productId)}/images/${encodeURIComponent(image.id)}/preview`} alt={`Imagen ${index + 1} del producto`} />
        <div className="image-order-copy"><strong>Imagen {index + 1}</strong><small>{imageStatusCopy(image)}</small></div>
        <div className="image-order-actions">
          <button className="icon-button" type="button" onClick={() => void move(image.id, -1)} disabled={index === 0 || Boolean(busyImageId)} aria-label={`Poner imagen ${index + 1} primero`} title="Subir posición">↑</button>
          <button className="icon-button" type="button" onClick={() => void move(image.id, 1)} disabled={index === images.length - 1 || Boolean(busyImageId)} aria-label={`Bajar imagen ${index + 1}`} title="Bajar posición">↓</button>
        </div>
      </li>)}
    </ol>}
    {status === 'failed' && <p className="inline-notice is-error" role="alert">La imagen original existente no se modifica.</p>}
    {status === 'ready' && <p className="inline-notice is-success" role="status">Cambios de imágenes listos.</p>}
  </section>
}
