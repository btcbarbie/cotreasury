// Member limits. Pure values, safe to use in the browser and on the server.

export const MEMBER_LIMIT_MAX = 500

/** Starting member limit for each kind of treasury. */
export function defaultMemberLimit(kind: string) {
  return kind === 'HOUSEHOLD' ? 2 : kind === 'GROUP_TRIP' ? 12 : 50
}
