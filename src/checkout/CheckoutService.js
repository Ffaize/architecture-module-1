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

    // the order is already paid here, so the email only goes to the queue
    const notification = this.notificationService.queueOrderEmail(order);

    return {
      order,
      payment,
      notification,
      durationMs: Math.round(performance.now() - startedAt)
    };
  }
}
