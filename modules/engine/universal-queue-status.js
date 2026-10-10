"use strict";

// Destination rows are the factual authority. A partial item is terminal
// only after every applicable destination has reached a factual outcome.
function classificarFilaUniversal(destinations = []) {
  if (!Array.isArray(destinations)) throw new Error("queue_destinations_required");
  if (destinations.length === 0) return { status: "no_opportunity", terminal: true };
  const counts = { sent: 0, skipped: 0, failed: 0, open: 0 };
  for (const destination of destinations) {
    const status = typeof destination === "string" ? destination : destination?.status;
    if (status === "sent") counts.sent += 1;
    else if (status === "skipped") counts.skipped += 1;
    else if (status === "failed") counts.failed += 1;
    else if (["pending", "claimed", "send_started", "ambiguous"].includes(status)) counts.open += 1;
    else throw new Error("queue_destination_state_unknown");
  }
  if (counts.open) return { status: counts.sent ? "partial" : "pending",
    terminal: false, counts };
  if (counts.sent === destinations.length) return { status: "sent", terminal: true, counts };
  if (counts.sent) return { status: "partial", terminal: true, counts };
  if (counts.failed) return { status: "error", terminal: true, counts };
  return { status: "not_sent", terminal: true, counts };
}

module.exports = { classificarFilaUniversal };
