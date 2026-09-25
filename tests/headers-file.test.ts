import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('public/_headers', () => {
  it('only contains path rules and indented "Name: value" header pairs', () => {
    const lines = readFileSync(resolve(__dirname, '../public/_headers'), 'utf8').split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith('#'))
    const invalid = lines.filter((line) => !(/^\/\S*$/.test(line) || /^\s+[A-Za-z0-9-]+:\s*\S/.test(line)))
    expect(invalid).toEqual([])
    expect(lines).toContain('/*')
    expect(lines).toContain('/assets/*')
    expect(lines.join('\n')).toContain('Cache-Control: public, max-age=31536000, immutable')
  })
})
