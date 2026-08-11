import "server-only";

export const PRIVATE_NO_STORE = {
  "Cache-Control": "private, no-store",
} as const;

export function jsonPrivate(data: unknown, init?: { status?: number }) {
  return Response.json(data, {
    status: init?.status ?? 200,
    headers: PRIVATE_NO_STORE,
  });
}
