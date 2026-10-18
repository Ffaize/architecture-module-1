export class CheckoutService {
  constructor({ orderService, inventoryService, paymentService, notificationService }) {
    this.orderService = orderService;
    this.inventoryService = inventoryService;
    this.paymentService = paymentService;
    this.notificationService = notificationService;
  }

  async checkout(command) {
    const startedAt = performance.now();
    let order = this.orderService.createDraft(command);
    let inventoryReserved = false;
    let payment;

    try {
      this.inventoryService.reserve(order);
      inventoryReserved = true;
      order = this.orderService.markInventoryReserved(order.id);

      payment = await this.paymentService.chargeOrder(order, command.paymentToken);
      order = this.orderService.markPaid(order.id, payment.id);
      order = this.orderService.complete(order.id);
    } catch (error) {
      if (inventoryReserved) this.inventoryService.release(order);
      this.orderService.fail(order.id, error.code ?? "UNEXPECTED_ERROR");
      throw error;
    }

    // The order is paid at this point, so email must never roll it back.
    // We only queue the confirmation; a background worker delivers it.
    const notification = this.notificationService.enqueueOrderConfirmation(order);

    return {
      order,
      payment,
      notification,
      durationMs: Math.round(performance.now() - startedAt)
    };
  }
}
