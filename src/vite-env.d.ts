/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_ENV?: 'DEVELOPMENT' | 'STAGING' | 'PRODUCTION';
  readonly VITE_EXPECTED_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  readonly VITE_FIREBASE_MEASUREMENT_ID?: string;
  readonly VITE_MEDIA_UPLOAD_URL?: string;
  readonly VITE_FUNCTIONS_REGION?: string;
  readonly VITE_DRIVE_INTEGRATION_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __FIREBASE_FALLBACK_CONFIG__: {
  apiKey?: string;
  authDomain?: string;
  projectId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
  measurementId?: string;
};
