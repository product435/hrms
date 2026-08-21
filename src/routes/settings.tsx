import { createFileRoute } from "@tanstack/react-router";
import { Bell, Building2, Shield, Users } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requireAuthForPath } from "@/lib/auth-guard";
import { ROLE_LABELS, useSession } from "@/hooks/useSession";

export const Route = createFileRoute("/settings")({
  beforeLoad: () => requireAuthForPath("/settings"),
  head: () => ({
    meta: [{ title: "Settings · TeamNest" }],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { user, role } = useSession();

  return (
    <AppLayout>
      <PageHeader
        eyebrow="Administration"
        title="Settings"
        description="Organisation profile, access policies and notification defaults."
      />

      <Tabs defaultValue="organisation" className="space-y-4">
        <TabsList>
          <TabsTrigger value="organisation">Organisation</TabsTrigger>
          <TabsTrigger value="access">Access</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
        </TabsList>

        <TabsContent value="organisation">
          <SectionCard
            title="Company profile"
                description="Branding and regional defaults shown across TeamNest."
            bodyClassName="space-y-4 p-5"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="company">Company name</Label>
                <Input id="company" defaultValue="Jeevijay Technologies" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="timezone">Primary timezone</Label>
                <Input id="timezone" defaultValue="Asia/Kolkata" />
              </div>
            </div>
            <Button disabled>Save organisation settings</Button>
          </SectionCard>
        </TabsContent>

        <TabsContent value="access">
          <SectionCard
            title="Your access"
            description="Role assignment is managed by HR and synced from profiles when Supabase is connected."
            bodyClassName="space-y-4 p-5"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-border bg-surface-2/60 p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <Users className="size-4 text-primary" /> Signed in as
                </div>
                <p className="text-sm">{user?.name}</p>
                <p className="text-xs text-muted-foreground">{user?.email}</p>
              </div>
              <div className="rounded-xl border border-border bg-surface-2/60 p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <Shield className="size-4 text-primary" /> Application role
                </div>
                <p className="text-sm">{ROLE_LABELS[role]}</p>
                <p className="text-xs text-muted-foreground">{user?.department}</p>
              </div>
            </div>
          </SectionCard>
        </TabsContent>

        <TabsContent value="notifications">
          <SectionCard
            title="Notification preferences"
            description="Configure which events generate inbox alerts and email digests."
            bodyClassName="space-y-4 p-5"
          >
            {[
              { icon: Bell, label: "Leave approvals", description: "Notify when requests need action" },
              { icon: Building2, label: "Payroll runs", description: "Alerts when payroll is processed" },
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between gap-4 rounded-xl border border-border p-4">
                <div className="flex items-start gap-3">
                  <item.icon className="mt-0.5 size-4 text-primary" />
                  <div>
                    <p className="text-sm font-semibold">{item.label}</p>
                    <p className="text-xs text-muted-foreground">{item.description}</p>
                  </div>
                </div>
                <Switch defaultChecked />
              </div>
            ))}
            <Button disabled>Save notification settings</Button>
          </SectionCard>
        </TabsContent>
      </Tabs>
    </AppLayout>
  );
}
