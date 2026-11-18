export type TowerSource = "opencellid" | "osm" | "community";

export type Tower = {
  id: string;
  lat: number;
  lon: number;
  op: string;
  radios: string[];
  cells?: number;
  samples?: number;
  /** estimated position uncertainty in metres */
  acc_m?: number;
  /** unix seconds, 0 or missing = unknown */
  first?: number;
  last?: number;
  /** position comes from a mapped OpenStreetMap mast */
  osm?: boolean;
  osm_m?: number;
  source: TowerSource;
  name?: string;
  note?: string;
  photo?: string;
};

export type NearTower = Tower & { dist: number; bearing: number };

export type Fix = {
  lat: number;
  lon: number;
  accuracy: number | null;
  /** m/s, null when unknown */
  speed: number | null;
  /** direction of travel in degrees, null when unknown */
  course: number | null;
  timestamp: number;
};

export type Age = "all" | "new" | "active" | "old";
export type Tab = "radar" | "map" | "add";
