export type TranslatorUiState = {
  inputEnabled: boolean
  outputEnabled: boolean
  lastRevision: number
}

declare module 'claude-code' {
  interface PluginState {
    'bilingual-translator': {
      ui: Shaped<TranslatorUiState>
    }
  }
}
