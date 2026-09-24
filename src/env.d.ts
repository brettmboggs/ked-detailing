interface ImportMetaEnv {
  /** The ked-api Worker, e.g. https://api.kedservice.com. Unset: /quote runs on built-in prices and texts leads instead. */
  readonly PUBLIC_KED_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
