import { apiFetch } from "@/lib/api";

/** Who may approve one kind of request in the organization (mirrors PolicyResponse). */
export interface ApprovalPolicy {
  request_type: "ASSET" | "SOFTWARE" | "RETURN" | "ISSUE" | "STOCK" | "PURCHASE_ORDER";
  approver_roles: string[];
  allow_self_approval: boolean;
  /** False while the default rule applies. */
  configured: boolean;
}

export const POLICY_LABEL: Record<ApprovalPolicy["request_type"], [string, string]> = {
  ASSET: ["Asset requests", "A user asks for a device."],
  SOFTWARE: ["Software access", "A user asks for a seat of a product."],
  RETURN: ["Device returns", "A user hands a device back."],
  ISSUE: ["Problems with assets", "Resolving a reported problem."],
  STOCK: ["Stock requests", "A user asks for consumables."],
  PURCHASE_ORDER: ["Purchase orders", "Approving (ordering) a purchase order."],
};

/** Roles that can be approvers; users and reporting users never approve. */
export const APPROVER_ROLES: [string, string][] = [
  ["IT_ADMIN", "IT Admin"],
  ["SUB_ADMIN", "Sub-admin"],
  ["SUPER_ADMIN", "Super Admin"],
];

export function listApprovalPolicies(): Promise<ApprovalPolicy[]> {
  return apiFetch<ApprovalPolicy[]>("/api/approval-policies");
}

export function updateApprovalPolicy(
  requestType: string,
  input: { approver_roles: string[]; allow_self_approval: boolean },
): Promise<ApprovalPolicy> {
  return apiFetch<ApprovalPolicy>(`/api/approval-policies/${encodeURIComponent(requestType)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}
