export interface DashboardIdentity {
  role?: unknown;
  site_id?: unknown;
  status?: unknown;
}

export function shouldHydrateAuthProfile(pinLoginInProgress: boolean): boolean {
  return !pinLoginInProgress;
}

export function canLoadDashboard(identity: DashboardIdentity | null | undefined): boolean {
  return Boolean(
    identity
    && identity.status === 'Active'
    && ['Guard', 'ShiftHead', 'Manager', 'Admin'].includes(String(identity.role || ''))
    && String(identity.site_id || '').trim(),
  );
}

export function isDashboardFailure(stage: string): boolean {
  return stage === 'AUTH-13';
}
