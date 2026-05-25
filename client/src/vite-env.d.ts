/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_COLYSEUS_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
