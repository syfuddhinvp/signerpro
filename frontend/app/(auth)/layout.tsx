/**
 * Unauthenticated layout. The auth screens paint their own full-bleed split
 * background, so this layout adds no chrome of its own — it exists to keep the
 * auth routes out of the application Shell.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
