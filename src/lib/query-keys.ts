/**
 * Query-key factory for the screens this pass owns.
 * Partial keys (the `.all` entries) are safe to pass to `invalidateQueries`.
 */
export const queryKeys = {
  notifications: {
    all: ["notifications"] as const,
    topbar: ["notifications", "topbar"] as const,
  },
  employees: {
    all: ["employees"] as const,
    assignable: ["employees", "assignable"] as const,
    detail: (employeeId: string) => ["employee", employeeId] as const,
  },
  attendance: {
    byEmployee: (employeeId: string) => ["attendance", employeeId] as const,
  },
  corrections: {
    all: ["corrections"] as const,
  },
  leave: {
    byEmployee: (employeeId: string) => ["leave", employeeId] as const,
    balance: (employeeId: string) => ["leave-balance", employeeId] as const,
  },
  assets: {
    byEmployee: (employeeId: string) => ["assets", employeeId] as const,
  },
  documents: {
    byEmployee: (employeeId: string) => ["documents", employeeId] as const,
  },
  goals: {
    byEmployee: (employeeId: string) => ["goals", employeeId] as const,
  },
  reviews: {
    byEmployee: (employeeId: string) => ["reviews", employeeId] as const,
  },
  complaints: {
    byEmployee: (employeeId: string) => ["complaints", employeeId] as const,
  },
  search: {
    global: (term: string) => ["global-search", term] as const,
  },
};
