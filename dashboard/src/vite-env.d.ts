/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly BASE_URL: string;
  readonly MODE: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_CONSOLE_BASE_URL?: string;
  readonly VITE_DOCS_BASE_URL?: string;
  // W3 — when set to "1" the pairing client synthesises responses
  // client-side instead of hitting /api/console/proof-pairing/*. Lets
  // the QR-proof demo page run end-to-end before the backend ships.
  readonly VITE_PAIRING_MOCK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
