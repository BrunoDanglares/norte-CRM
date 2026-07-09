import { useEffect, useState } from "react";
import { authService } from "../services/auth";
import { Zap } from "lucide-react";
import { prefetchRoute } from "@/lib/prefetch";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    const check = async () => {
      if (!authService.isAuthenticated()) {
        window.location.href = "/login";
        return;
      }
      try {
        await authService.me();
        setAuthenticated(true);
        const schedule = typeof requestIdleCallback === "function" ? requestIdleCallback : (cb: () => void) => setTimeout(cb, 100);
        schedule(() => {
          prefetchRoute("/");
          prefetchRoute("/crm");
          prefetchRoute("/inbox");
        });
      } catch {
        authService.logout();
      } finally {
        setChecking(false);
      }
    };
    check();
  }, []);

  if (checking) {
    return (
      <div className="flex items-center justify-center h-screen bg-background" data-testid="loading-auth">
        <div className="flex flex-col items-center gap-3">
          <div className="w-[52px] h-[52px] rounded-[14px] gradient-accent flex items-center justify-center animate-pulse">
            <Zap className="w-6 h-6 text-white" />
          </div>
          <span className="text-[13px] text-muted-foreground">Verificando autenticacao...</span>
        </div>
      </div>
    );
  }

  return authenticated ? <>{children}</> : null;
}
