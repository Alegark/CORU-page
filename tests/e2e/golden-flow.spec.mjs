import { test, expect } from '@playwright/test'

test.describe('CORU golden paths', () => {
  test('mobile: three rings, Bs bubble and one WhatsApp intent', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')

    for (const name of ['Órbita oscura', 'Calavera orbital', 'Estrella rota']) {
      await page.getByRole('button', { name: `Agregar ${name}` }).click()
    }
    await expect(page.locator('.floating-cart')).toBeVisible()
    await expect(page.locator('.floating-cart-count')).toHaveText('3')
    await page.getByRole('button', { name: 'Bs' }).click()
    await expect(page.getByText('Si envías tu pedido hoy, la tasa en Bs queda protegida hasta finalizar el día.')).toBeVisible()
    await page.getByRole('button', { name: 'Abrir carrito, 3 productos' }).click()
    await expect(page.getByText('Al generar tu pedido, el monto en Bs mantendrá la tasa asignada hasta finalizar hoy.')).toHaveCount(0)
    await expect(page.locator('.cart-footer-scroll')).toHaveCount(0)

    const whatsapp = page.waitForEvent('popup')
    await page.getByRole('button', { name: 'Pedir por WhatsApp' }).click()
    const whatsappPage = await whatsapp
    await expect(whatsappPage).toHaveURL(/whatsapp|wa\.me/i)
    await expect(page.locator('.cart-panel')).toHaveCount(0)
  })

  test('desktop: store grid and admin orders route remain reachable', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    await expect(page.locator('.product-grid')).toBeVisible()
    await page.goto('/admin/pedidos')
    await expect(page.getByRole('heading', { name: 'Pedidos', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Pendientes' })).toBeVisible()
    await page.goto('/admin/entregas')
    await expect(page.getByRole('heading', { name: 'Puntos de entrega', exact: true })).toBeVisible()
    await expect(page.getByRole('listbox', { name: 'Puntos de entrega personales' })).toBeVisible()
  })

  test('mobile: STOCK shipping selector keeps personal list, Yummy fallback and national fields usable', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await page.getByRole('button', { name: 'Agregar Órbita oscura' }).click()
    await page.getByRole('button', { name: 'Abrir carrito, 1 producto' }).click()
    await expect(page.getByText('Entrega para piezas disponibles')).toBeVisible()
    await expect(page.getByText('Los productos bajo pedido se solicitan por separado')).toHaveCount(0)
    await expect(page.getByRole('option', { name: /Punto CORU/ })).toBeVisible()

    await page.getByRole('button', { name: 'Yummy' }).click()
    await page.getByLabel('Dirección de entrega').fill('Av. Bella Vista, Maracaibo')
    await page.getByRole('button', { name: 'Consultar costo' }).click()
    await expect(page.getByText('Costo de delivery a confirmar por WhatsApp.')).toBeVisible()

    await page.getByRole('button', { name: 'Nacional' }).click()
    await page.getByLabel('Estado').fill('Zulia')
    await page.getByLabel('Ciudad').fill('Maracaibo')
    await expect(page.getByText('Cobro a destino · cobertura nacional.')).toBeVisible()
  })
})
