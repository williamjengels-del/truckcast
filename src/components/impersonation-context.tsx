"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Client-side impersonation state, populated by the dashboard layout
 * (server component) and consumed by client components that need to
 * know which user they're effectively rendering for.
 *
 * Populated for ALL dashboard renders. When the admin is not
 * impersonating (the common case), isImpersonating is false and
 * effectiveUserId is just their own id. Client components can
 * therefore use useImpersonation().effectiveUserId unconditionally as
 * their "current user" without branching logic at every call site.
 *
 * Scope:
 *   * 5c-i (this commit) populates the provider. Nothing consumes it
 *     yet — this is infrastructure for 5d (banner) + 5c-iv (client
 *     read rewrites that fetch from /api/dashboard/*).
 *   * 5d adds an impersonation banner somewhere near the top of the
 *     dashboard that reads `isImpersonating`, `targetLabel`, and
 *     `expiresAt` from here and renders accordingly.
 *   * 5c-iv has the six rewired client components read
 *     `effectiveUserId` to pass as a query param to the scoped
 *     /api/dashboard/* endpoints.
 */
export interface ImpersonationState {
  /** True when the signed impersonation cookie is active for this session. */
  isImpersonating: boolean;
  /**
   * The user_id whose data the dashboard is currently rendering.
   * Always set to a non-null string when the user is authenticated —
   * equal to realUserId when not impersonating, equal to the target's
   * id when impersonating.
   */
  effectiveUserId: string | null;
  /** The real authenticated user's id (the admin when impersonating). */
  realUserId: string | null;
  /**
   * Human-readable label for the target when impersonating.
   * Business name if set, else email, else uuid. Null when not
   * impersonating (no banner to render).
   */
  targetLabel: string | null;
  /** Epoch ms when the impersonation session expires. Null when not impersonating. */
  expiresAt: number | null;
}

const defaultState: ImpersonationState = {
  isImpersonating: false,
  effectiveUserId: null,
  realUserId: null,
  targetLabel: null,
  expiresAt: null,
};

const ImpersonationContext = createContext<ImpersonationState>(defaultState);

export function ImpersonationProvider({
  value,
  children,
}: {
  value: ImpersonationState;
  children: ReactNode;
}) {
  return (
    <ImpersonationContext.Provider value={value}>
      {children}
    </ImpersonationContext.Provider>
  );
}

/**
 * Client-side hook for impersonation state.
 *
 * Safe to call from any client component rendered under the dashboard
 * layout. Outside the provider (e.g. from the marketing site), returns
 * the default state with isImpersonating=false and all ids null —
 * callers should still branch on isImpersonating first.
 */
export function useImpersonation(): ImpersonationState {
  return useContext(ImpersonationContext);
}
