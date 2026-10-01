import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Building2, Shield, Users } from "lucide-react";
import { toast } from "sonner";
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
import { ChangePasswordForm } from "@/components/auth/ChangePasswordForm";
import { settingsService } from "@/services/settingsService";
import { BetaTab } from "@/components/settings/BetaTab";

export const Route = createFileRoute("/settings")({
  beforeLoad: () => requireAuthForPath("/settings"),
  head: () => ({
    meta: [{ title: "Settings · JeeVijay HRMS" }],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { user, role } = useSession();
  const queryClient = useQueryClient();

  const organization = useQuery({
    queryKey: ["organization-settings"],
    queryFn: () => settingsService.organization(),
  });
  const [orgForm, setOrgForm] = useState({ name: "", timezone: "" });
  useEffect(() => {
    if (organization.data) setOrgForm(organization.data);
  }, [organization.data]);
  const saveOrganization = useMutation({
    mutationFn: () => settingsService.updateOrganization(orgForm),
    onSuccess: () => {
      toast.success("Organisation settings saved");
      void queryClient.invalidateQueries({ queryKey: ["organization-settings"] });
    },
    onError: (e) =>
      toast.error("Could not save organisation settings", {
        description: e instanceof Error ? e.message : "Supabase request failed.",
      }),
  });

  const notificationPrefs = useQuery({
    queryKey: ["notification-preferences"],
    queryFn: () => settingsService.notificationPreferences(),
  });
  const [notifForm, setNotifForm] = useState({ leaveApprovals: true, payrollRuns: true });
  useEffect(() => {
    if (notificationPrefs.data) setNotifForm(notificationPrefs.data);
  }, [notificationPrefs.data]);
  const saveNotifications = useMutation({
    mutationFn: () => settingsService.updateNotificationPreferences(notifForm),
    onSuccess: () => {
      toast.success("Notification settings saved");
      void queryClient.invalidateQueries({ queryKey: ["notification-preferences"] });
    },
    onError: (e) =>
      toast.error("Could not save notification settings", {
        description: e instanceof Error ? e.message : "Supabase request failed.",
      }),
  });

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
          {role === "admin" && <TabsTrigger value="beta">Beta</TabsTrigger>}
        </TabsList>

        <TabsContent value="organisation">
          <SectionCard
            title="Company profile"
            description="Branding and regional defaults shown across JeeVijay HRMS."
            bodyClassName="space-y-4 p-5"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="company">Company name</Label>
                <Input
                  id="company"
                  value={orgForm.name}
                  onChange={(event) => setOrgForm({ ...orgForm, name: event.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="timezone">Primary timezone</Label>
                <Input
                  id="timezone"
                  value={orgForm.timezone}
                  onChange={(event) => setOrgForm({ ...orgForm, timezone: event.target.value })}
                />
              </div>
            </div>
            <Button
              onClick={() => saveOrganization.mutate()}
              disabled={saveOrganization.isPending || organization.isLoading}
            >
              {saveOrganization.isPending ? "Saving…" : "Save organisation settings"}
            </Button>
          </SectionCard>
        </TabsContent>

        <TabsContent value="access" className="space-y-4">
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
          <ChangePasswordForm />
        </TabsContent>

        <TabsContent value="notifications">
          <SectionCard
            title="Notification preferences"
            description="Configure which events generate inbox alerts and email digests."
            bodyClassName="space-y-4 p-5"
          >
            {[
              {
                key: "leaveApprovals" as const,
                icon: Bell,
                label: "Leave approvals",
                description: "Notify when requests need action",
              },
              {
                key: "payrollRuns" as const,
                icon: Building2,
                label: "Payroll runs",
                description: "Alerts when payroll is processed",
              },
            ].map((item) => (
              <div
                key={item.key}
                className="flex items-center justify-between gap-4 rounded-xl border border-border p-4"
              >
                <div className="flex items-start gap-3">
                  <item.icon className="mt-0.5 size-4 text-primary" />
                  <div>
                    <p className="text-sm font-semibold">{item.label}</p>
                    <p className="text-xs text-muted-foreground">{item.description}</p>
                  </div>
                </div>
                <Switch
                  checked={notifForm[item.key]}
                  onCheckedChange={(checked) => setNotifForm({ ...notifForm, [item.key]: checked })}
                />
              </div>
            ))}
            <Button
              onClick={() => saveNotifications.mutate()}
              disabled={saveNotifications.isPending || notificationPrefs.isLoading}
            >
              {saveNotifications.isPending ? "Saving…" : "Save notification settings"}
            </Button>
          </SectionCard>
        </TabsContent>

        {role === "admin" && (
          <TabsContent value="beta">
            <BetaTab />
          </TabsContent>
        )}
      </Tabs>
    </AppLayout>
  );
}
