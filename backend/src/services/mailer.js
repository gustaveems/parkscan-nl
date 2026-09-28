import nodemailer from "nodemailer";

let transportPromise = null;

function boolEnv(v, fallback = false) {
  if (v == null || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(v).toLowerCase());
}

export function getDeliveryConfig() {
  return {
    mode: process.env.OUTREACH_DELIVERY_MODE || "internal_inbox",
    testTo: process.env.OUTREACH_TEST_TO || "",
    fromEmail: process.env.OUTREACH_FROM_EMAIL || "parkscan@example.local",
    smtpHost: process.env.SMTP_HOST || "",
    smtpPort: Number(process.env.SMTP_PORT || 587),
    smtpUser: process.env.SMTP_USER || "",
    smtpPass: process.env.SMTP_PASS || "",
    smtpSecure: boolEnv(process.env.SMTP_SECURE, false),
  };
}

async function getTransport() {
  if (!transportPromise) {
    const config = getDeliveryConfig();
    if (!config.smtpHost || !config.smtpUser || !config.smtpPass) {
      throw new Error("SMTP transport is not fully configured");
    }
    transportPromise = Promise.resolve(
      nodemailer.createTransport({
        host: config.smtpHost,
        port: config.smtpPort,
        secure: config.smtpSecure,
        auth: {
          user: config.smtpUser,
          pass: config.smtpPass,
        },
      }),
    );
  }
  return transportPromise;
}

export function resetMailer() {
  transportPromise = null;
}

export async function sendOutreachMessage({
  subject,
  body,
  requestedTo,
}) {
  const config = getDeliveryConfig();
  const deliveryTo = config.mode === "internal_inbox" || config.mode === "mock"
    ? config.testTo || requestedTo
    : requestedTo || config.testTo;

  if (!deliveryTo) {
    throw new Error("OUTREACH_TEST_TO is required for outreach delivery");
  }

  if (config.mode === "mock") {
    return {
      mode: "mock",
      deliveryTo,
      messageId: `mock-${Date.now()}`,
    };
  }

  if (config.mode !== "internal_inbox") {
    throw new Error(`Unsupported outreach delivery mode: ${config.mode}`);
  }

  const transport = await getTransport();
  const info = await transport.sendMail({
    from: config.fromEmail,
    to: deliveryTo,
    subject,
    text: body,
  });

  return {
    mode: config.mode,
    deliveryTo,
    messageId: info.messageId || null,
  };
}
