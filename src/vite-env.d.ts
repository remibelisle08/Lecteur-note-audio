/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** ID client OAuth Google (public) pour la synchro Drive ; absent → synchro non configurée. */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
