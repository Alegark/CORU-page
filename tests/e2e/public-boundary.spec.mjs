import { test, expect } from '@playwright/test'

const adminAssetPattern = /(?:AdminShell|AdminPages|features\/admin\/|api\/admin(?:\.|\/)|admin-[A-Za-z0-9_-]+\.css)/i

function assetRequests(requests) {
  return requests.filter((url) => /\.(?:js|css|tsx|ts)(?:\?|$)/i.test(new URL(url).pathname) || url.includes('/src/client/'))
}

test.describe('public/Admin dependency boundary', () => {
  for (const route of ['/', '/producto/orbita-oscura', '/guia-de-tallas']) {
    test(`public route ${route} does not request Admin assets`, async ({ page }) => {
      const requests = []
      page.on('request', (request) => requests.push(request.url()))

      await page.goto(route)
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(400)

      const publicAssets = assetRequests(requests)
      expect(publicAssets.filter((url) => adminAssetPattern.test(url)), publicAssets.join('\n')).toEqual([])
    })
  }

  test('admin route loads its deferred assets only after entering Admin', async ({ page }) => {
    const requests = []
    page.on('request', (request) => requests.push(request.url()))

    await page.goto('/admin')
    await expect(page.locator('.admin-shell')).toBeVisible()

    expect(assetRequests(requests).some((url) => adminAssetPattern.test(url))).toBe(true)
  })
})
