import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SizeGuidePage } from '../src/client/features/catalog/SizeGuidePage'

describe('SizeGuidePage', () => {
  it('renders the approved guide structure and exact measurement copy', () => {
    render(<SizeGuidePage />)

    expect(screen.getByRole('heading', { level: 1, name: '¿Cómo saber tu talla de anillo?' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Método 1: mide un anillo que ya uses' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Método 2: mide tu dedo' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Tabla de tallas CORU' })).toBeInTheDocument()
    expect(screen.getByText('Mide el diámetro interior del anillo, de borde interno a borde interno, en línea recta.')).toBeInTheDocument()
    expect(screen.getByText('Anota la medida en centímetros y compárala con la tabla de tallas.')).toBeInTheDocument()
    expect(screen.getByText('Mide esa longitud en centímetros con una regla.')).toBeInTheDocument()
    expect(screen.getByText('Prepara una tira de papel, hilo o cinta no elástica.')).toBeInTheDocument()
    expect(screen.getByText('Compárala con la tabla de tallas.')).toBeInTheDocument()
  })

  it('keeps the approved US 5–10 table semantic and complete', () => {
    render(<SizeGuidePage />)

    const table = screen.getByRole('table')
    expect(table).toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(7)
    expect(screen.getByRole('row', { name: /5 1\.57 cm 4\.93 cm/ })).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /10 1\.98 cm 6\.21 cm/ })).toBeInTheDocument()
    expect(screen.queryByText(/EU|UK|MX/)).not.toBeInTheDocument()
  })

  it('exposes accessible vector descriptions and return actions', () => {
    render(<SizeGuidePage />)

    expect(screen.getByRole('img', { name: /Anillo CORU plateado y negro listo para medir/ })).toHaveAttribute('src', '/coru-ring-hero.png')
    expect(screen.getByRole('img', { name: /Anillo CORU sobre una regla para medir el diámetro interior/ })).toHaveAttribute('src', '/coru-medir-anillo.png')
    expect(screen.getByRole('img', { name: /Medición de la circunferencia del dedo/ })).toHaveAttribute('src', '/coru-medir-dedo.svg')
    expect(screen.getByRole('link', { name: 'Volver a la colección' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: 'Volver a la tienda' })).toHaveAttribute('href', '/')
  })
})
