const viteEnvironment: Partial<ImportMetaEnv> = import.meta.env ?? {};
const configuredRegion = String(viteEnvironment.VITE_FUNCTIONS_REGION || '').trim();
const configuredProjectId = String(viteEnvironment.VITE_FIREBASE_PROJECT_ID || '').trim();

export const FUNCTIONS_REGION = configuredRegion || 'asia-southeast1';

export function firebaseFunctionUrl(functionName: string): string {
  if (!configuredProjectId || !functionName.trim()) return '';
  return `https://${FUNCTIONS_REGION}-${configuredProjectId}.cloudfunctions.net/${functionName}`;
}

export const MEDIA_UPLOAD_URL =
  String(viteEnvironment.VITE_MEDIA_UPLOAD_URL || '').trim()
  || firebaseFunctionUrl('uploadVehicleEvidence');

export const PRIVATE_MEDIA_URL =
  String(viteEnvironment.VITE_PRIVATE_MEDIA_URL || '').trim()
  || firebaseFunctionUrl('getVehicleEvidenceImage');
