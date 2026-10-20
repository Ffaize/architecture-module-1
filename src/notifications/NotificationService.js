import { formatMoney } from "../shared/money.js";

const CONFIRMATION_TEMPLATE = "ORDER_CONFIRMATION_V1";

export class NotificationService {
  constructor(database, provider, { maxAttempts = 5 } = {}) {
    this.database = database;
    this.provider = provider;
    this.maxAttempts = maxAttempts;
    this.isSending = false;
  }

  // we don't send right away, just put the email in the queue,
  // so a broken mail provider can't fail a paid order
  queueOrderEmail(order) {
    const emailId = `${CONFIRMATION_TEMPLATE}:${order.id}`;
    const alreadyQueued = this.database.emailQueue.get(emailId);
    if (alreadyQueued) return structuredClone(alreadyQueued);

    const email = {
      id: emailId,
      orderId: order.id,
      template: CONFIRMATION_TEMPLATE,
      to: order.customer.email,
      subject: `Order ${order.id} confirmed`,
      body: `Thanks ${order.customer.name}. Your total is ${formatMoney(order.totalCents)}.`,
      status: "QUEUED",
      attempts: 0,
      createdAt: new Date().toISOString()
    };
    this.database.emailQueue.set(emailId, email);
    return structuredClone(email);
  }

  async sendQueuedEmails() {
    if (this.isSending) return 0;
    this.isSending = true;

    try {
      const queued = [...this.database.emailQueue.values()].filter((email) => email.status === "QUEUED");
      for (const email of queued) {
        await this.#send(email);
      }
      return queued.length;
    } finally {
      this.isSending = false;
    }
  }

  async #send(email) {
    const attempts = email.attempts + 1;

    try {
      const result = await this.provider.sendEmail({
        to: email.to,
        subject: email.subject,
        body: email.body
      });

      this.database.emailQueue.set(email.id, { ...email, status: "SENT", attempts });
      this.database.notifications.push({
        id: result.providerMessageId,
        orderId: email.orderId,
        channel: "EMAIL",
        template: email.template,
        status: "SENT",
        latencyMs: result.latencyMs,
        sentAt: new Date().toISOString()
      });
    } catch (error) {
      // give up after maxAttempts, otherwise try again next time
      const status = attempts >= this.maxAttempts ? "FAILED" : "QUEUED";
      this.database.emailQueue.set(email.id, { ...email, status, attempts, lastError: error.message });
    }
  }
}
