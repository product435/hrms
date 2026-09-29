import { useMutation } from "@tanstack/react-query";
import { Eye } from "lucide-react";
import { toast } from "sonner";
import { SectionCard } from "@/components/common/SectionCard";
import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";
import { shortDate } from "@/lib/format";
import { workplaceService } from "@/services/workplaceService";
import type { DocumentItem } from "@/types";

export function DocumentsTab({ documents }: { documents: DocumentItem[] | undefined }) {
  const viewDocument = useMutation({
    mutationFn: async (filePath: string) => {
      const tab = window.open("", "_blank");
      try {
        const url = await workplaceService.getDocumentUrl(filePath);
        if (tab) tab.location.href = url;
        else window.location.href = url;
      } catch (error) {
        tab?.close();
        throw error;
      }
    },
    onError: (error) =>
      toast.error("Could not open document", {
        description: error instanceof Error ? error.message : "Try again.",
      }),
  });

  return (
    <TabsContent value="documents" className="mt-4">
      <SectionCard title="Documents" bodyClassName="p-0">
        <ul className="divide-y divide-border">
          {(documents ?? []).map((doc) => (
            <li key={doc.id} className="flex items-center gap-3 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{doc.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {doc.category} · {doc.size} · uploaded {shortDate(doc.uploadedOn)}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={
                  !doc.filePath ||
                  (viewDocument.isPending && viewDocument.variables === doc.filePath)
                }
                onClick={() => doc.filePath && viewDocument.mutate(doc.filePath)}
                title={doc.filePath ? "View / open document" : "File not available"}
              >
                <Eye className="size-3.5" /> View
              </Button>
            </li>
          ))}
          {documents?.length === 0 ? (
            <li className="px-5 py-8 text-center text-sm text-muted-foreground">
              No documents on file.
            </li>
          ) : null}
        </ul>
      </SectionCard>
    </TabsContent>
  );
}
