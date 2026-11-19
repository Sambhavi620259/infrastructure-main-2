import { StockManager } from "@/components/inventory/stock-manager";

export default function StockPage() {
  return <StockManager eyebrow="Inventory · Stock / Available Items" addHref="/inventory/new" />;
}
