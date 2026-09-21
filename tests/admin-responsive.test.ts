import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const adminStyles = readFileSync(resolve(process.cwd(), 'src/client/design/admin.css'), 'utf8')
const mobileStyles = adminStyles.slice(
  adminStyles.indexOf('@media (max-width: 767px)'),
  adminStyles.indexOf('@media (min-width: 481px) and (max-width: 767px)'),
)

describe('Admin responsive layout', () => {
  it('keeps the shell and analytics content inside a narrow viewport', () => {
    expect(mobileStyles).toMatch(/\.admin-shell\s*\{[\s\S]*?width:\s*100%;/)
    expect(mobileStyles).toMatch(/\.admin-content\s*\{[\s\S]*?width:\s*100%;/)
    expect(mobileStyles).toMatch(/\.admin-main\s*\{[\s\S]*?box-sizing:\s*border-box;[\s\S]*?width:\s*calc\(100%\s*-\s*28px\);/)
    expect(mobileStyles).toMatch(/\.analytics-page,\s*\.analytics-page\s*>\s*\*,\s*\.analytics-toolbar,\s*\.analytics-periods\s*\{[\s\S]*?min-width:\s*0;/)
  })
})
