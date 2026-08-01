interface FirebaseRuntimeConfig {
  apiKey?: string;
  projectId?: string;
  authDomain?: string;
  storageBucket?: string;
  appId?: string;
  measurementId?: string;
}

export interface RuntimeValidationResult {
  environment: 'development' | 'production';
  environmentName: 'DEVELOPMENT' | 'STAGING' | 'PRODUCTION';
  projectId: string;
  mediaUploadConfigured: boolean;
  analyticsEnabled: boolean;
}

const requiredHttpsUrl = (name: string, value: string) => {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname) throw new Error();
  } catch {
    throw new Error(`${name} must be an absolute HTTPS URL.`);
  }
};

function expectedFunctionUrl(projectId: string, region: string, functionName: string): string {
  return `https://${region}-${projectId}.cloudfunctions.net/${functionName}`;
}

export function validateRuntimeConfiguration(
  firebaseConfig: FirebaseRuntimeConfig,
  environment: 'development' | 'production' = import.meta.env.PROD ? 'production' : 'development',
  runtimeEnv: Record<string, unknown> = import.meta.env,
): RuntimeValidationResult {
  const projectId = String(firebaseConfig.projectId || '').trim();
  const environmentName = String(runtimeEnv.VITE_APP_ENV || (environment === 'production' ? 'PRODUCTION' : 'DEVELOPMENT')).toUpperCase();
  if (!['DEVELOPMENT', 'STAGING', 'PRODUCTION'].includes(environmentName)) {
    throw new Error('VITE_APP_ENV must be DEVELOPMENT, STAGING, or PRODUCTION.');
  }
  const authDomain = String(firebaseConfig.authDomain || '').trim();
  const storageBucket = String(firebaseConfig.storageBucket || '').trim();
  const appId = String(firebaseConfig.appId || '').trim();
  if (!projectId || !authDomain || !storageBucket || !appId) {
    throw new Error('Firebase runtime configuration is incomplete.');
  }
  if (environment === 'production') {
    const expectedProjectId = String(runtimeEnv.VITE_EXPECTED_FIREBASE_PROJECT_ID || 'securityprojectv1').trim();
    if (projectId !== expectedProjectId) {
      throw new Error(`Firebase project mismatch: expected ${expectedProjectId}, received ${projectId}.`);
    }
    if (!authDomain.endsWith('.firebaseapp.com')) {
      throw new Error('Firebase authDomain is invalid for production.');
    }
  }
  if (environmentName === 'STAGING' && projectId === 'securityprojectv1') {
    throw new Error('Staging build cannot target the Production Firebase project.');
  }
  if (environmentName === 'STAGING') {
    const apiKey = String(firebaseConfig.apiKey || '').trim();
    const functionsRegion = String(runtimeEnv.VITE_FUNCTIONS_REGION || '').trim();
    const driveIntegrationMode = String(runtimeEnv.VITE_DRIVE_INTEGRATION_MODE || '').trim();
    const measurementId = String(firebaseConfig.measurementId || '').trim();
    if (!apiKey) throw new Error('Staging Firebase API key is missing.');
    if (!functionsRegion) throw new Error('VITE_FUNCTIONS_REGION is required for staging.');
    if (!measurementId) {
      console.warn('Firebase Analytics disabled: VITE_FIREBASE_MEASUREMENT_ID is not configured.');
    }
    if (driveIntegrationMode !== 'OAuth2User') {
      throw new Error('Staging Drive integration must use OAuth2User.');
    }
  }
  if (environmentName === 'PRODUCTION' && projectId !== 'securityprojectv1') {
    throw new Error('Production build cannot target a staging Firebase project.');
  }
  const mediaUploadUrl = String(runtimeEnv.VITE_MEDIA_UPLOAD_URL || '').trim();
  const privateMediaUrl = String(runtimeEnv.VITE_PRIVATE_MEDIA_URL || '').trim();
  if (mediaUploadUrl) requiredHttpsUrl('VITE_MEDIA_UPLOAD_URL', mediaUploadUrl);
  if (privateMediaUrl) requiredHttpsUrl('VITE_PRIVATE_MEDIA_URL', privateMediaUrl);
  if (environmentName === 'STAGING' && !mediaUploadUrl) {
    throw new Error('VITE_MEDIA_UPLOAD_URL is required for staging.');
  }
  if (environmentName === 'STAGING' || environmentName === 'PRODUCTION') {
    const functionsRegion = String(runtimeEnv.VITE_FUNCTIONS_REGION || '').trim();
    if (!functionsRegion) {
      throw new Error(`VITE_FUNCTIONS_REGION is required for ${environmentName.toLowerCase()}.`);
    }
    const expectedMediaUploadUrl = expectedFunctionUrl(projectId, functionsRegion, 'uploadVehicleEvidence');
    if (mediaUploadUrl && mediaUploadUrl !== expectedMediaUploadUrl) {
      throw new Error(`VITE_MEDIA_UPLOAD_URL must match the configured ${environmentName.toLowerCase()} Functions region: ${expectedMediaUploadUrl}`);
    }
    const expectedPrivateMediaUrl = expectedFunctionUrl(projectId, functionsRegion, 'getVehicleEvidenceImage');
    if (privateMediaUrl && privateMediaUrl !== expectedPrivateMediaUrl) {
      throw new Error(`VITE_PRIVATE_MEDIA_URL must match the configured ${environmentName.toLowerCase()} Functions region: ${expectedPrivateMediaUrl}`);
    }
  }
  return {
    environment,
    environmentName: environmentName as RuntimeValidationResult['environmentName'],
    projectId,
    mediaUploadConfigured: Boolean(mediaUploadUrl),
    analyticsEnabled: Boolean(String(firebaseConfig.measurementId || '').trim()),
  };
}
