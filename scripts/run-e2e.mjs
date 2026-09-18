try {
  await import('@playwright/test')
} catch {
  console.log('E2E omitida: instala @playwright/test y el navegador del proyecto para ejecutarla.')
  process.exit(0)
}

const { spawn } = await import('node:child_process')
const args = ['exec', 'playwright', 'test', '--config=playwright.config.mjs']
const command = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'pnpm'
const commandArgs = process.platform === 'win32' ? ['/d', '/s', '/c', 'pnpm exec playwright test --config=playwright.config.mjs'] : args
// Windows exposes pnpm as a .cmd shim, which Node 24 cannot spawn directly
// without cmd.exe. The command is static, so the explicit shell handoff keeps
// the wrapper cross-platform without relying on shell argument concatenation.
const child = spawn(command, commandArgs, {
  stdio: 'inherit',
  env: process.env,
})
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
