// Composição do shell (equivalente ao AdminLayout do nexus-react): Sidebar |
// (Topbar + #layout-content). O #layout-content perde o p-6 do template porque
// as páginas do CRM já trazem padding + scroll próprios (h-full overflow-y-auto).
import { useEffect, useState, type ReactNode } from "react";
import { NexusSidebar } from "./Sidebar";
import { NexusTopbar } from "./Topbar";
import { NexusRightbar } from "./Rightbar";
import { applyNexusConfig } from "@/lib/nexus-config";

export function NexusLayout({ title, children }: { title: string; children: ReactNode }) {
  const [rightbarOpen, setRightbarOpen] = useState(false);

  // Aplica a personalização (tema/sidebar/fonte/direção) no boot do shell.
  useEffect(() => { applyNexusConfig(); }, []);

  return (
    <div className="flex h-full w-full overflow-hidden">
      <NexusSidebar />
      <div className="flex min-w-0 grow flex-col overflow-hidden">
        <NexusTopbar title={title} onOpenSettings={() => setRightbarOpen(true)} />
        <div id="layout-content" className="min-h-0 grow overflow-hidden !p-0 bg-base-200/40">
          {children}
        </div>
      </div>
      <NexusRightbar open={rightbarOpen} onClose={() => setRightbarOpen(false)} />
    </div>
  );
}
