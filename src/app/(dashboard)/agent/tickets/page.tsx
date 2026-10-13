import { TicketQueue } from "@/components/tickets/ticket-queue";

export default function AgentTicketsPage() {
  return <TicketQueue eyebrow="User · Tickets" title="My Tickets" canHandle={false} />;
}
