// Reference to vite/client removed to avoid "Cannot find type definition file" error.

interface ImportMetaEnv {
  readonly VITE_GEMINI_API_KEY: string
  // more env variables...
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
