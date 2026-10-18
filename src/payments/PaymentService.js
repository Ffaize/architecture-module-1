import { DomainError, ExternalDependencyError } from "../shared/errors.js";

export class PaymentService {
  constructor(database, provider) {
    this.database = database;
    this.provider = provider;
  }

  // Checkout passes the order data Payments needs (id, totalCents, currency),
  // so Payments no longer reads the Orders repository directly.
  async chargeOrder(order, paymentToken) {
    if (!order?.id) throw new DomainError("Order is required for payment", "ORDER_NOT_FOUND", 404);
    const orderId = order.id;

    const existing = [...this.database.payments.values()].find(
      (payment) => payment.orderId === orderId && payment.status === "CAPTURED"
    );
    if (existing) return structuredClone(existing);

    if (!paymentToken) {
      throw new DomainError("Payment token is required", "PAYMENT_TOKEN_REQUIRED");
    }

    const payment = {
      id: this.database.nextId("payment"),
      orderId,
      amountCents: order.totalCents,
      currency: order.currency,
      status: "PROCESSING",
      createdAt: new Date().toISOString()
    };
    this.database.payments.set(payment.id, payment);

    try {
      const providerResult = await this.provider.charge({
        amountCents: order.totalCents,
        currency: order.currency,
        reference: order.id,
        paymentToken
      });
      const captured = {
        ...payment,
        status: "CAPTURED",
        provider: providerResult.provider,
        providerPaymentId: providerResult.providerPaymentId,
        providerLatencyMs: providerResult.latencyMs,
        capturedAt: new Date().toISOString()
      };
      this.database.payments.set(payment.id, captured);
      return structuredClone(captured);
    } catch (error) {
      this.database.payments.set(payment.id, {
        ...payment,
        status: "FAILED",
        failedAt: new Date().toISOString()
      });
      if (error instanceof ExternalDependencyError) throw error;
      throw new ExternalDependencyError("Payment provider failed", "FakePay", error);
    }
  }

  findByOrderId(orderId) {
    const payment = [...this.database.payments.values()].find((entry) => entry.orderId === orderId);
    return payment ? structuredClone(payment) : null;
  }
}
