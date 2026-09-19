/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BE_ORIGIN?: string;
  /** "fixture" runs the board against the in-memory client in lib/fixture-api.ts. Anything else (including unset) uses the live API. */
  readonly VITE_API_MODE?: string;
}
