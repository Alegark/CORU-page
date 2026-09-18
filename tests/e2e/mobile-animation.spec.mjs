import { test, expect } from '@playwright/test'

test('mobile add tap releases transient product-card visual state', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  })
  const page = await context.newPage()

  try {
    await page.goto('/')
    const addButton = page.locator('.add-button').first()
    const card = addButton.locator('xpath=ancestor::article')
    const artwork = card.locator('.product-card-image img, .product-card-image .ring-art').first()

    await addButton.tap()
    await page.waitForTimeout(250)

    await expect.poll(async () => addButton.evaluate((element) => getComputedStyle(element).transform)).toBe('none')
    await expect.poll(async () => card.evaluate((element) => getComputedStyle(element).transform)).toBe('none')
    await expect.poll(async () => artwork.evaluate((element) => getComputedStyle(element).transform)).toBe('none')
    await expect.poll(async () => page.locator('.floating-cart').evaluate((element) => getComputedStyle(element).animationName)).toBe('none')
  } finally {
    await context.close()
  }
})
