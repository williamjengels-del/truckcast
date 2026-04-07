export type JourneyState =
  | "new_user"      // 0 events
  | "building"      // 1-9 events, <3 with sales
  | "logging"       // has events, needs more sales logged (3+ events but <50% have sales)
  | "calibrating"   // 10-29 events with sales — forecasts building confidence
  | "calibrated";   // 30+ events with sales — high confidence forecasts

export interface JourneyContext {
  state: JourneyState;
  totalEvents: number;
  eventsWithSales: number;
  hasPOS: boolean;
  hasUpcoming: boolean;
  nextStep: {
    label: string;
    href: string;
    description: string;
  };
}

const TODAY = new Date().toISOString().split("T")[0];

const NEXT_STEPS: Record<JourneyState, { label: string; href: string; description: string }> = {
  new_user: {
    label: "Add your first event",
    href: "/dashboard/events?new=true",
    description: "Start by adding a past or upcoming event to your account.",
  },
  building: {
    label: "Import past events to build history",
    href: "/dashboard/events/import",
    description: "Import events from a CSV to build your history faster.",
  },
  logging: {
    label: "Log sales on past events",
    href: "/dashboard/events",
    description: "Enter actual sales after each event so forecasts improve.",
  },
  calibrating: {
    label: "Keep logging sales — forecasts sharpen at 30 events",
    href: "/dashboard/events",
    description: "Accuracy improves significantly once you reach 30 events with sales.",
  },
  calibrated: {
    label: "View your calibrated forecasts",
    href: "/dashboard/forecasts",
    description: "Your forecast model has high confidence — explore your upcoming projections.",
  },
};

export function computeJourneyState(
  events: Array<{ booked: boolean; net_sales: number | null; event_date: string }>,
  hasPOS: boolean
): JourneyContext {
  const totalEvents = events.length;
  const eventsWithSales = events.filter(
    (e) => e.net_sales !== null && e.net_sales > 0
  ).length;
  const hasUpcoming = events.some((e) => e.event_date > TODAY);

  let state: JourneyState;

  if (totalEvents === 0) {
    state = "new_user";
  } else if (eventsWithSales >= 30) {
    state = "calibrated";
  } else if (eventsWithSales >= 10) {
    state = "calibrating";
  } else if (totalEvents >= 3 && eventsWithSales < totalEvents * 0.5) {
    state = "logging";
  } else {
    // totalEvents 1-9, or totalEvents >= 3 but eventsWithSales >= 50% and < 10
    // The spec defines "building" as 1-9 events with <3 sales.
    // If we fall through here with totalEvents >= 3 and eventsWithSales >= 50%
    // but still < 10, we treat as calibrating-ready but use "building" as the
    // closest match since eventsWithSales < 10.
    state = "building";
  }

  return {
    state,
    totalEvents,
    eventsWithSales,
    hasPOS,
    hasUpcoming,
    nextStep: NEXT_STEPS[state],
  };
}
