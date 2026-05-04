import { redirect } from "next/navigation";

// Inbox root → land on the Direct bookings tab. Marketplace inquiries
// is the busier surface for active operators, but Direct is the
// older + more familiar one and works as the safer default. Operators
// can toggle via the tab bar in the layout above.
export default function InboxIndexPage() {
  redirect("/dashboard/inbox/direct");
}
