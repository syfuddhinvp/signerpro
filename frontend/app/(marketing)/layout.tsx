/**
 * Public marketing layout. Like the auth routes, the marketing page paints its
 * own full-bleed background, so this layout adds no chrome — it exists to keep
 * marketing out of the application Shell and out of the auth split-screen.
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
