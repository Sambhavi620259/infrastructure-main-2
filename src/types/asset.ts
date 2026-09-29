export type AssetStatus = "in_stock" | "assigned" | "in_repair" | "retired";
export type AssetType = "hardware" | "software" | "cloud" | "peripheral";

export interface Asset {
  id: string;
  tag: string;
  name: string;
  type: AssetType;
  status: AssetStatus;
}
