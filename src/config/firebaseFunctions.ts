const configuredRegion = String(import.meta.env.VITE_FUNCTIONS_REGION || '').trim();
const configuredProjectId = String(import.meta.env.VITE_FIREBASE_PROJECT_ID || '').trim();

export const FUNCTIONS_REGION = configuredRegion || 'us-central1';

export function firebaseFunctionUrl(functionName: string): string {
  if (!configuredProjectId || !functionName.trim()) return '';
  return `https://${FUNCTIONS_REGION}-${configuredProjectId}.cloudfunctions.net/${functionName}`;
}

export const MEDIA_UPLOAD_URL =
  String(import.meta.env.VITE_MEDIA_UPLOAD_URL || '').trim()
  || firebaseFunctionUrl('uploadVehicleEvidence');
