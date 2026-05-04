/**
 * Ομαδοποίηση τρόπου πληρωμής για Magento + Viva (Stonewave): συγχωνεύει `payment.method`,
 * `payment.additional_information` και ετικέτες τύπου «Viva Payment Method» / «Sub-Payment Method».
 */

function stripInstructionNoise(s: string): string {
  let t = s.trim();
  const boiler = t.search(/Προκειμένου\s+να/i);
  if (boiler >= 0) t = t.slice(0, boiler).trim();
  t = t.replace(/\s+GR\d{2}[0-9A-Z]+\s*$/i, '').trim();
  t = t.replace(/\s*\.\s*$/, '').trim();
  return t;
}

/** Εξαγωγή τιμής από «Label: value» σε additional_information */
function extractLabeledValue(text: string, re: RegExp): string {
  const m = text.match(re);
  return m?.[1]?.trim() || '';
}

function normalizeBlob(raw: string, methodCode: string): string {
  return `${raw}\n${methodCode}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/**
 * Ετικέτα για pie chart (ελληνικές κατηγορίες όπου είναι δυνατό).
 */
export function paymentChartLabelForEcommerceOrder(order: {
  platform: string;
  paymentMethod?: string;
  paymentMethodCode?: string;
}): string {
  const raw = String(order.paymentMethod || '').trim();
  const code = String(order.paymentMethodCode || '').trim().toLowerCase();
  const blob = normalizeBlob(raw, code);

  if (order.platform === 'magento') {
    const mag = resolveMagentoPaymentBucket(raw, blob, code);
    if (mag) return mag;
  }

  const fallback = stripInstructionNoise(raw.split(/\n+/)[0] || '').replace(/\s+/g, ' ').trim();
  return fallback || '—';
}

function resolveMagentoPaymentBucket(
  displayRaw: string,
  blob: string,
  methodCode: string
): string | null {
  const subLabel =
    extractLabeledValue(displayRaw, /sub[\s_-]*payment[\s_-]*method\s*[:]\s*([^\n•]+)/i) ||
    extractLabeledValue(displayRaw, /viva[\s_-]*payment[\s_-]*method\s*[:]\s*([^\n•]+)/i);
  const probe = `${subLabel}\n${displayRaw}`;

  if (/\bklarna\b/i.test(probe)) return 'Klarna';
  if (/\b(iris|iris\s*digital|iris\s*payment)\b/i.test(probe)) return 'IRIS';
  if (/\bpaypal\b/i.test(probe)) return 'PayPal';
  if (/\b(google\s*pay|apple\s*pay|gpay)\b/i.test(probe)) return 'Κάρτες';

  if (
    /αντικαταβολ|cash\s*on\s*delivery|cashondelivery|^cod$|\bcod\b|μετρητά\s*στην\s*παράδοση/i.test(blob)
  ) {
    return 'Αντικαταβολή';
  }
  if (/(τραπεζ|bank|καταθεση|κατάθεση|deposit|wire|iban|checkmo|banktransfer)/i.test(blob)) {
    return 'Τραπεζική κατάθεση';
  }
  if (/\b(card|καρτ|credit|debit|mastercard|visa|amex|maestro|viva)\b/i.test(blob)) {
    return 'Κάρτες';
  }

  const codeMap: Record<string, string> = {
    cashondelivery: 'Αντικαταβολή',
    checkmo: 'Τραπεζική κατάθεση',
    banktransfer: 'Τραπεζική κατάθεση',
    paypal_express: 'PayPal',
    braintree: 'Κάρτες',
    viva_wallet: 'Κάρτες',
    viva: 'Κάρτες',
  };
  if (methodCode && codeMap[methodCode]) return codeMap[methodCode];

  return null;
}
