function ts() {
  return new Date().toISOString()
}

export const logger = {
  info: (...args: unknown[]) => console.log(`[${ts()}]`, ...args),
  warn: (...args: unknown[]) => console.warn(`[${ts()}]`, ...args),
  error: (...args: unknown[]) => console.error(`[${ts()}]`, ...args),
}
