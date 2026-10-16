"use client";

import { useParams } from "next/navigation";
import { TicketDetail } from "@/components/tickets/ticket-detail";

export default function TicketPage() {
  const params = useParams<{ id: string }>();
  return <TicketDetail key={params.id} ticketId={params.id} workspace="user" />;
}
