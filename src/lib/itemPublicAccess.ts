/**
 * Anonymous / unauthenticated access: only this row's `is_public` matters.
 * A private file inside a public folder stays hidden until marked public.
 * (Email-based shares use a separate path in ItemsController.)
 */
export function isPublicForAnonymousAccess(item: Record<string, unknown>): boolean {
  return item.is_public === true;
}
