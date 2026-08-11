/** Default is mock so local UI keeps working without Supabase/Nylas. */
export function getEmailDataSourceMode(): "mock" | "api" {
  const value = process.env.NEXT_PUBLIC_EMAIL_DATA_SOURCE?.trim().toLowerCase();
  return value === "api" ? "api" : "mock";
}

export function isMockEmailDataSource() {
  return getEmailDataSourceMode() === "mock";
}

export function isApiEmailDataSource() {
  return getEmailDataSourceMode() === "api";
}
