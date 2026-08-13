/**
 * Jivadaya Payment Connector SDK
 * Domain: https://payment.jivadaya.org
 * 
 * Programmatic helper to trigger CCAvenue / Razorpay payment flows.
 */

(function (window) {
  'use strict';

  const PAYMENTS_ENDPOINT = 'https://payment.jivadaya.org/api/payment/initiate';

  const JivadayaPayment = {
    /**
     * Initiates a payment by constructing a dynamic HTML form and submitting it.
     * @param {Object} params Payment details payload
     * @param {string} params.amount Mandatory donation amount in INR
     * @param {string} params.billing_name Donor full name
     * @param {string} [params.billing_email] Donor email
     * @param {string} [params.billing_tel] Donor phone number
     * @param {string} [params.pg='ccavenue'] Payment Gateway ('ccavenue' | 'razorpay')
     * @param {string} [params.order_id] Custom order ID
     * @param {string} [params.webhook_url] S2S webhook URL
     * @param {string} [params.callback_url] Customer redirect URL
     * @param {boolean} [params.openInNewTab=false] Whether to open payment page in a new window/tab
     */
    initiate: function (params) {
      if (!params || !params.amount) {
        console.error('[JivadayaPayment] Error: Amount is required to initiate payment.');
        alert('Please specify a valid donation amount.');
        return;
      }

      // Create hidden form element
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = PAYMENTS_ENDPOINT;
      
      if (params.openInNewTab) {
        form.target = '_blank';
      }

      // Populate input parameters
      const payload = Object.assign({
        pg: 'ccavenue',
        campaign_slug: 'default',
        need_80g: 'No'
      }, params);

      delete payload.openInNewTab;

      Object.keys(payload).forEach(key => {
        if (payload[key] !== undefined && payload[key] !== null) {
          const input = document.createElement('input');
          input.type = 'hidden';
          input.name = key;
          input.value = payload[key];
          form.appendChild(input);
        }
      });

      document.body.appendChild(form);
      form.submit();

      // Clean up form after submit
      setTimeout(function () {
        if (form.parentNode) {
          form.parentNode.removeChild(form);
        }
      }, 1000);
    }
  };

  window.JivadayaPayment = JivadayaPayment;

})(window);
