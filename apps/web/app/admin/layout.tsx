import { AdminAuthProvider } from "@/components/console/admin-auth";
import { AdminShell } from "@/components/console/admin-shell";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminAuthProvider>
      <AdminShell>{children}</AdminShell>
    </AdminAuthProvider>
  );
}
