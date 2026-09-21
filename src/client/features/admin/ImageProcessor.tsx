import { useEffect, useState, type ChangeEvent } from 'react'
import { ApiClientError, fetchAdminImages, reorderAdminImages, type AdminImageRecord } from '../../api/admin'

export type ImageUploadState = 'idle' | 'uploading' | 'ready' | 'failed'

type ImageProcessorProps = {
  productId: string
  onUpload?: (file: File) => Promise<AdminImageRecord | void> | AdminImageRecord | void
  onChanged?: () => Promise<void> | void
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

export function ImageProcessor({ productId, onUpload, onChanged }: ImageProcessorProps) {
  const [status, setStatus] = useState<ImageUploadState>('idle')
  const [message, setMessage] = useState('Las imágenes se guardan tal como las subes.')
  const [images, setImages] = useState<AdminImageRecord[]>([])
  const [busyImageId, setBusyImageId] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    fetchAdminImages(productId).then((loaded) => { if (active) setImages(sortImages(loaded)) }).catch(() => undefined)
    return () => { active = false }
  }, [productId])

  async function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setStatus('failed'); setMessage('Formato no válido. Usa JPG, PNG o WEBP.'); return }
    if (file.size > 15 * 1024 * 1024) { setStatus('failed'); setMessage('La imagen supera el límite de 15 MB.'); return }
    setStatus('uploading'); setMessage('Guardando imagen original…')
    try {
      const uploaded = await onUpload?.(file)
      if (uploaded) setImages((current) => sortImages([...current.filter((image) => image.id !== uploaded.id), uploaded]))
      setStatus('ready'); setMessage('Imagen guardada sin alterar. Puedes cambiar su posición abajo.')
      await onChanged?.()
    } catch (error) {
      setStatus('failed'); setMessage(error instanceof ApiClientError ? `${error.message} (${error.code})` : error instanceof Error ? error.message : 'No se pudo guardar la imagen original.')
    }
  }

  async function move(imageId: string, direction: -1 | 1) {
    if (busyImageId) return
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

  return <section className={`image-processor image-${status}`} aria-labelledby="image-processor-title">
    <div>
      <span className="eyebrow">Galería del producto</span>
      <h2 id="image-processor-title">Sube tus imágenes tal como son.</h2>
      <p>{message}</p>
      <small>{IMAGE_HELP}</small>
    </div>
    <div className="image-processor-actions">
      <label className="button button-secondary">
        <span>{status === 'uploading' ? 'Guardando…' : 'Subir imagen'}</span>
        <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleChange} disabled={status === 'uploading' || Boolean(busyImageId)} />
      </label>
    </div>
    {images.length > 0 && <ol className="image-order-list" aria-label="Orden de imágenes del producto">
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
