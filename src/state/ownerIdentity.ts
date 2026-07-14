import type { AuthUser } from './AuthContext';

export interface AppOwnerIdentity {
  memoryOwner: string;
  mainStateOwner: string;
  /** Remount boundary for reducer state that is persisted under mainStateOwner. */
  mainStateProviderKey: string;
}

export function resolveAppOwnerIdentity(user: AuthUser | null): AppOwnerIdentity {
  const memoryOwner = user?.memoryOwner ?? user?.id ?? user?.username ?? 'anonymous';
  const mainStateOwner = user?.username ?? 'anonymous';
  return {
    memoryOwner,
    mainStateOwner,
    mainStateProviderKey: mainStateOwner,
  };
}
