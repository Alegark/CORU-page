import { useEffect, useState, type ChangeEvent } from 'react'
import { ApiClientError, approveAdminImage, fetchAdminImages, retryAdminImage, type AdminImageRecord } from '../../api/client'

export type ImageUploadState = 'idle' | 'uploading' | 'ready' | 'failed'

type ImageProcessorProps = {
  productId: string
  onUpload?: (file: File) => Promise<AdminImageRecord | void> | AdminImageRecord | void
  onChanged?: () => Promise<void> | void
}

function statusCopy(record: AdminImageRecord | undefined): string {
  if (!record) return 'JPG, PNG o WEBP · máximo 15 MB'
  if (record.processingStatus === 'READY') return 'Procesamiento listo. Revisa y aprueba el resultado.'
  if (record.processingStatus === 'FAILED') return 'No se pudo procesar. El original se conserva para reintentar o aprobarlo.'
  return 'Guardando original y procesando…'
}

export function ImageProcessor({ productId, onUpload, onChanged }: ImageProcessorProps) {
  const [status, setStatus] = useState<ImageUploadState>('idle')
  const [message, setMessage] = useState('JPG, PNG o WEBP · máximo 15 MB')
  const [images, setImages] = useState<AdminImageRecord[]>([])
  const [busyAction, setBusyAction] = useState<'retry' | 'original' | 'processed' | null>(null)

  useEffect(() => {
    let active = true
    fetchAdminImages(productId).then((loaded) => { if (active) { setImages(loaded); setMessage(statusCopy(loaded.at(-1))) } }).catch(() => undefined)
    return () => { active = false }
  }, [productId])

  const latest = images.at(-1)

  async function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setStatus('failed'); setMessage('Formato no válido. Usa JPG, PNG o WEBP.'); return }
    if (file.size > 15 * 1024 * 1024) { setStatus('failed'); setMessage('La imagen supera el límite de 15 MB.'); return }
    setStatus('uploading'); setMessage('Guardando original y procesando…')
    try {
      const uploaded = await onUpload?.(file)
      if (uploaded) setImages((current) => [...current.filter((image) => image.id !== uploaded.id), uploaded])
      const result = uploaded ?? latest
      setStatus(result?.processingStatus === 'FAILED' ? 'failed' : 'ready'); setMessage(statusCopy(result))
      await onChanged?.()
    } catch (error) {
      setStatus('failed'); setMessage(error instanceof ApiClientError ? `${error.message} (${error.code})` : error instanceof Error ? error.message : 'No se pudo procesar. El original se conserva para reintentar o aprobarlo.')
    }
  }

  async function retry() {
    if (!latest || busyAction) return
    setBusyAction('retry'); setStatus('uploading'); setMessage('Reintentando procesamiento…')
    try {
      const updated = await retryAdminImage(productId, latest.id)
      setImages((current) => current.map((image) => image.id === updated.id ? updated : image))
      setStatus(updated.processingStatus === 'FAILED' ? 'failed' : 'ready'); setMessage(statusCopy(updated))
      await onChanged?.()
    } catch (error) { setStatus('failed'); setMessage(error instanceof ApiClientError ? `${error.message} (${error.code})` : error instanceof Error ? error.message : 'No se pudo reintentar el procesamiento.') }
    finally { setBusyAction(null) }
  }

  async function approve(variant: 'original' | 'processed') {
    if (!latest || busyAction) return
    setBusyAction(variant)
    try {
      const updated = await approveAdminImage(productId, latest.id, variant)
      setImages((current) => current.map((image) => image.id === updated.id ? updated : image))
      setStatus('ready'); setMessage(variant === 'processed' ? 'Imagen procesada aprobada y visible en el catálogo.' : 'Imagen original aprobada y visible en el catálogo.')
      await onChanged?.()
    } catch (error) { setStatus('failed'); setMessage(error instanceof ApiClientError ? `${error.message} (${error.code})` : error instanceof Error ? error.message : 'No se pudo aprobar esta imagen.') }
    finally { setBusyAction(null) }
  }

  return <section className={`image-processor image-${status}`} aria-labelledby="image-processor-title"><div><span className="eyebrow">Imagen del producto</span><h2 id="image-processor-title">Fondo limpio, pieza protagonista.</h2><p>{message}</p>{latest && <small>Estado: {latest.processingStatus === 'READY' ? 'procesada' : latest.processingStatus === 'FAILED' ? 'fallida' : 'en proceso'}{latest.approvedVariant ? ` · aprobada (${latest.approvedVariant})` : ''}</small>}</div><div className="image-processor-actions"><label className="button button-secondary"><span>{status === 'uploading' ? 'Procesando…' : 'Subir imagen'}</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleChange} disabled={status === 'uploading' || Boolean(busyAction)} /></label>{latest?.processingStatus === 'FAILED' && <button className="button button-ghost" type="button" onClick={() => void retry()} disabled={Boolean(busyAction)}>Reintentar</button>}{latest && !latest.approvedVariant && <><button className="button button-ghost" type="button" onClick={() => void approve('original')} disabled={Boolean(busyAction)}>Aprobar original</button>{latest.processingStatus === 'READY' && <button className="button button-primary" type="button" onClick={() => void approve('processed')} disabled={Boolean(busyAction)}>Aprobar procesada</button>}</>}</div>{status === 'failed' && <p className="inline-notice is-error" role="alert">El original sigue disponible.</p>}{status === 'ready' && <p className="inline-notice is-success" role="status">Procesamiento listo para revisión.</p>}</section>
}
