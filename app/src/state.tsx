import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { BUNDLED, fetchCommunity, loadCachedCommunity, makeFilter } from "./data";
import { useGps } from "./hooks";
import type { Age, Fix, Tab, Tower } from "./types";

type Ctx = {
  fix: Fix | null;
  denied: boolean;
  towers: Tower[];
  byId: Map<string, Tower>;
  communityCount: number;
  operator: string | null;
  setOperator: (o: string | null) => void;
  age: Age;
  setAge: (a: Age) => void;
  /** towers passing the current operator + age filters */
  pass: (t: Tower) => boolean;
  /** explicitly chosen tower (from the list or the map); null = follow the nearest */
  targetId: string | null;
  setTargetId: (id: string | null) => void;
  tab: Tab;
  setTab: (t: Tab) => void;
  refreshCommunity: () => Promise<void>;
};

const AppCtx = createContext<Ctx | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const { fix, denied } = useGps();
  const [community, setCommunity] = useState<Tower[]>([]);
  const [operator, setOperatorRaw] = useState<string | null>(null);
  const [age, setAgeRaw] = useState<Age>("all");
  const [targetId, setTargetId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("radar");

  const refreshCommunity = useCallback(async () => setCommunity(await fetchCommunity()), []);

  useEffect(() => {
    loadCachedCommunity().then(setCommunity);
    refreshCommunity();
  }, [refreshCommunity]);

  const towers = useMemo(() => BUNDLED.concat(community), [community]);
  const byId = useMemo(() => new Map(towers.map((t) => [t.id, t])), [towers]);
  const pass = useMemo(() => makeFilter(operator, age), [operator, age]);

  // changing a filter drops a manual target that no longer matches it
  const setOperator = useCallback((o: string | null) => {
    setOperatorRaw(o);
    setTargetId((id) => (id && o && byId.get(id)?.op !== o ? null : id));
  }, [byId]);
  const setAge = useCallback((a: Age) => {
    setAgeRaw(a);
    setTargetId(null);
  }, []);

  const value: Ctx = {
    fix, denied, towers, byId,
    communityCount: community.length,
    operator, setOperator, age, setAge, pass,
    targetId, setTargetId, tab, setTab, refreshCommunity,
  };
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp() {
  const v = useContext(AppCtx);
  if (!v) throw new Error("useApp outside AppProvider");
  return v;
}
