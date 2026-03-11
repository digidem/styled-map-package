import 'vitest'

declare module 'vitest' {
  export interface ProvidedContext {
    smpServerUrl: string
  }
}
