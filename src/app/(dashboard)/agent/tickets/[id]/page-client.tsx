"use client";

import { useRouteId } from "@/lib/route-id";
import { TicketDetail } from "@/components/tickets/ticket-detail";

export default function TicketPage() {
  const params = useRouteId();
  return <TicketDetail key={params.id} ticketId={params.id} workspace="user" />;
}
