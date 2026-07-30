export type WorkspaceLifecycle =
  | 'idle'
  | 'opening'
  | 'active'
  | 'releasing'
  | 'release-failed';

export interface WorkspaceState<TContext> {
  lifecycle: WorkspaceLifecycle;
  resourceId: string;
  resourceIdentity: string;
  context: TContext | null;
  releaseError: string;
}

export function createIdleWorkspace<TContext>(): WorkspaceState<TContext> {
  return {
    lifecycle: 'idle',
    resourceId: '',
    resourceIdentity: '',
    context: null,
    releaseError: '',
  };
}

export function openWorkspace<TContext>(
  resourceIdentity: string,
): WorkspaceState<TContext> {
  return {
    ...createIdleWorkspace<TContext>(),
    lifecycle: 'opening',
    resourceIdentity,
  };
}

export function activateWorkspace<TContext>(input: {
  resourceId: string;
  resourceIdentity: string;
  context: TContext;
}): WorkspaceState<TContext> {
  if (!input.resourceId || !input.resourceIdentity) {
    throw new Error('Workspace requires both a resource id and identity');
  }
  return {
    lifecycle: 'active',
    resourceId: input.resourceId,
    resourceIdentity: input.resourceIdentity,
    context: input.context,
    releaseError: '',
  };
}

export function beginWorkspaceRelease<TContext>(
  workspace: WorkspaceState<TContext>,
): WorkspaceState<TContext> {
  if (!workspace.resourceId || !workspace.context) {
    throw new Error('Cannot release an inactive workspace');
  }
  return {
    ...workspace,
    lifecycle: 'releasing',
    releaseError: '',
  };
}

export function failWorkspaceRelease<TContext>(
  workspace: WorkspaceState<TContext>,
  reason: unknown,
): WorkspaceState<TContext> {
  if (!workspace.resourceId || !workspace.context) {
    throw new Error('Cannot record a release failure for an inactive workspace');
  }
  return {
    ...workspace,
    lifecycle: 'release-failed',
    releaseError: reason instanceof Error ? reason.message : String(reason),
  };
}
