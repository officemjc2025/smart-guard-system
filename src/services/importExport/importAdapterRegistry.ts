export type ExplicitImportAdapter =
  | 'units'
  | 'parkingCards'
  | 'operators'
  | 'keys'
  | 'blacklist'
  | 'incidents'
  | 'workflowDenied';

const ADAPTERS: Readonly<Record<string, ExplicitImportAdapter>> = Object.freeze({
  units: 'units',
  'parking-cards': 'parkingCards',
  operators: 'operators',
  keys: 'keys',
  blacklist: 'blacklist',
  'incident-reports': 'workflowDenied',
  'vehicle-logs': 'workflowDenied',
  'contractor-logs': 'workflowDenied',
  'patrol-logs': 'workflowDenied',
  'key-logs': 'workflowDenied',
});

export function resolveImportAdapter(moduleKey: string): ExplicitImportAdapter {
  const adapter = ADAPTERS[moduleKey];
  if (!adapter) throw new Error(`Unsupported import module: ${moduleKey}`);
  return adapter;
}

export const registeredImportModuleKeys = (): string[] => Object.keys(ADAPTERS);
