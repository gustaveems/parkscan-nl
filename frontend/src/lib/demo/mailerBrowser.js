// Browser stand-in for backend/src/services/mailer.js.
// Nothing is ever sent — messages are recorded and logged instead.

export function getDeliveryConfig() {
  return {
    enabled: true,
    mode: "browser-demo",
    from: "ParkScan Demo <no-reply@parkscan.demo>",
    replyTo: null,
    requestedTo: null,
    approvalsRequired: true,
  };
}

export function resetMailer() {}

export async function sendOutreachMessage({ subject, body, requestedTo }) {
  // eslint-disable-next-line no-console
  console.info("[demo mailer] would have sent to", requestedTo, "—", subject);
  return { status: "logged", deliveryMode: "browser-demo", bytes: (body || "").length };
}
