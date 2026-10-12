import { redirect } from "next/navigation";

// Software licences are managed under Inventory.
export default function SoftwarePage() {
  redirect("/inventory/software");
}
