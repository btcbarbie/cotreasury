// How a payout reaches someone: PayPal sends it to an email address or a US
// mobile number, and the person claims it (creating a free PayPal account if
// they don't have one). Venmo payouts exist too, but PayPal's sandbox rejects
// them ("Recipient wallet not supported in sandbox"), so they aren't offered.

export type ReceiverType = 'EMAIL' | 'PHONE'

export const RECEIVER_TYPES: { id: ReceiverType; label: string; placeholder: string }[] = [
  { id: 'EMAIL', label: 'Email', placeholder: "Recipient's email" },
  { id: 'PHONE', label: 'Phone', placeholder: 'US mobile, e.g. 555 123 4567' },
]

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Check and normalise what someone typed for this recipient type. */
export function normalizeReceiver(type: string, raw: string): { ok: true; receiver: string } | { ok: false; error: string } {
  const v = raw.trim()
  if (type === 'PHONE') {
    const digits = v.replace(/\D/g, '')
    const phone = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
    return phone.length === 10 ? { ok: true, receiver: phone } : { ok: false, error: `“${v || '(empty)'}” isn’t a 10-digit US mobile number.` }
  }
  if (!EMAIL.test(v)) {
    const hint = /@[^.\s]+$/.test(v) ? ` It looks incomplete. Did you mean ${v}.com?` : ''
    return { ok: false, error: `“${v || '(empty)'}” isn’t a full email address.${hint}` }
  }
  return { ok: true, receiver: v.toLowerCase() }
}

/** The fields PayPal Payouts needs for this recipient. */
export function paypalRecipient(type: string, receiver: string) {
  return { recipient_type: type === 'PHONE' ? 'PHONE' : 'EMAIL', receiver }
}

/** Human-readable recipient, e.g. "(555) 123-4567". */
export function receiverLabel(receiver: string) {
  return /^\d{10}$/.test(receiver) ? `(${receiver.slice(0, 3)}) ${receiver.slice(3, 6)}-${receiver.slice(6)}` : receiver
}
