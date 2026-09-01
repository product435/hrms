import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { authService, type AuthSession } from "@/services/authService";
import type { Role, SessionUser } from "@/types";

interface SessionContextValue {
  user: SessionUser;
  role: Role;
  isAuthenticated: boolean;
  isLoading: boolean;
  signOut: () => void;
  can: (roles: Role[]) => boolean;
  refresh: () => void;
}

const SessionContext = createContext<SessionContextValue>({
  user: {
    id: "",
    name: "JeeVijay HRMS user",
    email: "",
    role: "employee",
    designation: "",
    department: "",
  },
  role: "employee",
  isAuthenticated: false,
  isLoading: true,
  signOut: () => {},
  can: () => false,
  refresh: () => {},
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const unsubscribe = authService.onSessionChange(setSession);
    void authService
      .initialize()
      .then((nextSession) => {
        if (!active) return;
        setSession(nextSession);
        setIsLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setSession(null);
        setIsLoading(false);
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      user: session?.user ?? {
        id: "",
        name: "JeeVijay HRMS user",
        email: "",
        role: "employee",
        designation: "",
        department: "",
      },
      role: session?.user?.role ?? "employee",
      isAuthenticated: Boolean(session),
      isLoading,
      signOut: () => {
        queryClient.clear();
        void authService.signOut();
      },
      can: (roles) => (session ? roles.includes(session.user.role) : false),
      refresh: () => setSession(authService.getSession()),
    }),
    [session, isLoading, queryClient],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  return useContext(SessionContext);
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  hr: "HR",
  manager: "Manager",
  employee: "Employee",
};
