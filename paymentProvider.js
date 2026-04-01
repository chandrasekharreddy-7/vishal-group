
module.exports = {
  async createIntent({ order, method }) {
    const normalized = method || order.payment_method || 'cod';
    const base = {
      integrationNeeded: normalized !== 'cod',
      method: normalized,
      provider: process.env.PAYMENT_PROVIDER || 'custom',
      amount: Number(order.total),
      currency: 'INR',
      orderId: order.id,
      nextAction: {
        serverFile: 'paymentProvider.js',
        frontendFieldsNeeded: ['providerOrderId', 'providerPaymentId', 'signature', 'upiIntentData', 'qrPayload']
      }
    };

    if (normalized === 'cod') {
      return { ...base, message: 'Cash on Delivery selected. Collect cash at doorstep.' };
    }
    if (normalized === 'upi') {
      return {
        ...base,
        upiId: process.env.MERCHANT_UPI_ID || 'merchant@upi',
        message: 'Collect payment using UPI intent or a gateway such as Razorpay, Cashfree, PhonePe, or Paytm.'
      };
    }
    if (normalized === 'scanpay') {
      const upiId = process.env.MERCHANT_UPI_ID || 'merchant@upi';
      const qrPayload = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent('KisanKart Seller')}&am=${Number(order.total).toFixed(2)}&cu=INR&tn=${encodeURIComponent(`Order ${order.id}`)}`;
      return {
        ...base,
        upiId,
        qrPayload,
        message: 'Render this UPI payload as a QR image or hand it to your payment gateway.'
      };
    }
    return {
      ...base,
      message: 'Fill this provider with Razorpay, Cashfree, PhonePe, Stripe, or your preferred payment gateway.'
    };
  },

  async confirmPayment({ orderId, providerPaymentId, status }) {
    return {
      success: true,
      orderId,
      providerPaymentId: providerPaymentId || '',
      normalizedStatus: status || 'paid'
    };
  }
};
