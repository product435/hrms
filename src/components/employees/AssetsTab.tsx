import { SectionCard } from "@/components/common/SectionCard";
import { StatusBadge } from "@/components/common/StatusBadge";
import { TabsContent } from "@/components/ui/tabs";
import { shortDate } from "@/lib/format";
import type { Asset } from "@/types";

export function AssetsTab({ assets }: { assets: Asset[] | undefined }) {
  return (
    <TabsContent value="assets" className="mt-4">
      <SectionCard title="Assigned assets" bodyClassName="p-0">
        <ul className="divide-y divide-border">
          {(assets ?? []).map((asset) => (
            <li key={asset.id} className="flex items-center gap-3 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{asset.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {asset.tag} · {asset.serial} · issued {shortDate(asset.assignedOn)}
                </p>
              </div>
              <StatusBadge status={asset.status} />
            </li>
          ))}
          {assets?.length === 0 ? (
            <li className="px-5 py-8 text-center text-sm text-muted-foreground">
              No assets assigned.
            </li>
          ) : null}
        </ul>
      </SectionCard>
    </TabsContent>
  );
}
