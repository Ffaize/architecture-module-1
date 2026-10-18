import { formatMoney } from "../shared/money.js";

const ORDER_CONFIRMATION = "ORDER_CONFIRMATION_V1";

export class NotificationService {
  constructor(database, provider, { maxAttempts = 5 } = {}) {
    this.database = database;
    this.provider = provider;
    this.maxAttempts = maxAttempts;
    this.delivering = false;
  }

  // Outbox: checkout only records that an email is due. Delivery happens later,
  // so a slow or broken mail provider cannot fail or slow down a paid order.
  enqueueOrderConfirmation(order) {
    const jobId = `${ORDER_CONFIRMATION}:${order.id}`;
    const existing = this.database.notificationJobs.get(jobId);
    if (existing) return structuredClone(existing);

    const job = {
      id: jobId,
      orderId: order.id,
      template: ORDER_CONFIRMATION,
      to: order.customer.email,
      subject: `Order ${order.id} confirmed`,
      body: `Thanks ${order.customer.name}. Your total is ${formatMoney(order.totalCents)}.`,
      status: "QUEUED",
      attempts: 0,
      createdAt: new Date().toISOString()
    };
    this.database.notificationJobs.set(jobId, job);
    return structuredClone(job);
  }

  async deliverPending() {
    if (this.delivering) return 0;
    this.delivering = true;
    try {
      const pending = [...this.database.notificationJobs.values()].filter(
        (job) => job.status === "QUEUED"
      );
      for (const job of pending) await this.#deliver(job);
      return pending.length;
    } finally {
      this.delivering = false;
    }
  }

  async #deliver(job) {
    const attempts = job.attempts + 1;
    try {
      const message = await this.provider.sendEmail({
        to: job.to,
        subject: job.subject,
        body: job.body
      });
      this.database.notificationJobs.set(job.id, { ...job, status: "SENT", attempts });
      this.database.notifications.push({
        id: message.providerMessageId,
        orderId: job.orderId,
        channel: "EMAIL",
        template: job.template,
        status: "SENT",
        latencyMs: message.latencyMs,
        sentAt: new Date().toISOString()
      });
    } catch (error) {
      this.database.notificationJobs.set(job.id, {
        ...job,
        attempts,
        lastError: error.message,
        status: attempts >= this.maxAttempts ? "FAILED" : "QUEUED"
      });
    }
  }
}
