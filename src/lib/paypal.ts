import { randomUUID } from 'crypto'

// Thin server-side PayPal REST client. Credentials never reach the browser
// except the public client id used by the JS SDK.

// Sandbox only, by design. There is deliberately no switch to live PayPal.
const BASE = 'https://api-m.sandbox.paypal.com'

let cached: { token: string; expiresAt: number } | null = null

async function accessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token
  const id = process.env.PAYPAL_CLIENT_ID
  const secret = process.env.PAYPAL_CLIENT_SECRET
  if (!id || !secret) throw new Error('PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET are not set')

  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    cache: 'no-store',
  })
  if (!res.ok) throw new PayPalError('Could not authenticate with PayPal', res.status, await res.text())
  const data = (await res.json()) as { access_token: string; expires_in: number }
  cached = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 }
  return data.access_token
}

export class PayPalError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: string,
  ) {
    super(message)
  }
  get debugId(): string | undefined {
    try {
      return JSON.parse(this.body).debug_id
    } catch {
      return undefined
    }
  }
}

async function paypal<T>(
  path: string,
  init: { method?: string; body?: unknown; rawJson?: string; requestId?: string } = {},
  attempt = 0,
): Promise<T> {
  const method = init.method ?? 'GET'
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await accessToken()}`,
    'Content-Type': 'application/json',
  }
  // Idempotency: retries with the same request id never double-charge or double-pay.
  if (method === 'POST') headers['PayPal-Request-Id'] = init.requestId ?? randomUUID()

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: init.rawJson ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
    cache: 'no-store',
  })

  if (res.status === 429 && attempt < 3) {
    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt))
    return paypal<T>(path, { ...init, requestId: headers['PayPal-Request-Id'] }, attempt + 1)
  }
  if (!res.ok) {
    const body = await res.text()
    const err = new PayPalError(`PayPal ${method} ${path} failed (${res.status})`, res.status, body)
    console.error(err.message, 'debug_id:', err.debugId)
    throw err
  }
  return (res.status === 204 ? undefined : await res.json()) as T
}

// ---------- Orders (contributions in) ----------

export type PayPalOrder = {
  id: string
  status: string
  purchase_units: {
    custom_id?: string
    payments?: { captures?: PayPalCapture[] }
  }[]
  payer?: { name?: { given_name?: string; surname?: string }; email_address?: string }
}

export type PayPalCapture = {
  id: string
  status: string // COMPLETED | PENDING | DECLINED | REFUNDED | ...
  amount: { currency_code: string; value: string }
  custom_id?: string
}

export function createOrder(opts: { amountCents: number; currency: string; customId: string; description: string }) {
  return paypal<PayPalOrder>('/v2/checkout/orders', {
    method: 'POST',
    body: {
      intent: 'CAPTURE',
      purchase_units: [
        {
          amount: { currency_code: opts.currency, value: (opts.amountCents / 100).toFixed(2) },
          custom_id: opts.customId,
          description: opts.description.slice(0, 127),
          soft_descriptor: 'COTREASURY',
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            shipping_preference: 'NO_SHIPPING',
            user_action: 'PAY_NOW',
            brand_name: 'CoTreasury',
          },
        },
      },
    },
  })
}

export function captureOrder(orderId: string) {
  // Request id derived from the order: a retried capture is a no-op, never a second charge.
  return paypal<PayPalOrder>(`/v2/checkout/orders/${orderId}/capture`, {
    method: 'POST',
    requestId: `capture-${orderId}`,
  })
}

export function getCapture(captureId: string) {
  return paypal<PayPalCapture>(`/v2/payments/captures/${captureId}`)
}

// ---------- Webhooks ----------

export async function verifyWebhookSignature(headers: Headers, rawBody: string): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID
  if (!webhookId) throw new Error('PAYPAL_WEBHOOK_ID is not set')
  const h = (name: string) => headers.get(name) ?? ''
  const fields = JSON.stringify({
    auth_algo: h('paypal-auth-algo'),
    cert_url: h('paypal-cert-url'),
    transmission_id: h('paypal-transmission-id'),
    transmission_sig: h('paypal-transmission-sig'),
    transmission_time: h('paypal-transmission-time'),
    webhook_id: webhookId,
  })
  // Splice in the exact bytes PayPal sent: re-serializing the event can change
  // number/whitespace formatting and make a genuine signature fail.
  const rawJson = `${fields.slice(0, -1)},"webhook_event":${rawBody}}`
  const result = await paypal<{ verification_status: string }>('/v1/notifications/verify-webhook-signature', {
    method: 'POST',
    rawJson,
  })
  return result.verification_status === 'SUCCESS'
}

// ---------- Payouts (approved spending out) ----------

export type PayoutItemStatus = 'SUCCESS' | 'FAILED' | 'PENDING' | 'UNCLAIMED' | 'RETURNED' | 'ONHOLD' | 'BLOCKED' | 'REFUNDED' | 'REVERSED' | 'DENIED' | 'NEW' | 'UNPROCESSED'

export type PayoutItem = {
  payout_item_id: string
  transaction_status: PayoutItemStatus
  payout_batch_id: string
  transaction_id?: string
  payout_item: { sender_item_id?: string; receiver?: string; amount?: { value: string; currency: string } }
  errors?: { name?: string; message?: string }
}

export type PayoutBatch = {
  batch_header: { payout_batch_id: string; batch_status: string; sender_batch_header?: { sender_batch_id?: string } }
  items?: PayoutItem[]
}

export function createPayoutBatch(opts: {
  senderBatchId: string
  subject: string
  message: string
  currency: string
  items: { senderItemId: string; receiver: string; recipientType: string; amountCents: number; note: string }[]
}) {
  return paypal<PayoutBatch>('/v1/payments/payouts', {
    method: 'POST',
    // sender_batch_id is PayPal's own duplicate guard; the request id makes HTTP retries safe too.
    requestId: `payout-${opts.senderBatchId}`,
    body: {
      sender_batch_header: {
        sender_batch_id: opts.senderBatchId,
        email_subject: opts.subject.slice(0, 255),
        email_message: opts.message.slice(0, 1000),
      },
      items: opts.items.map((i) => ({
        recipient_type: i.recipientType,
        receiver: i.receiver,
        amount: { value: (i.amountCents / 100).toFixed(2), currency: opts.currency },
        sender_item_id: i.senderItemId,
        note: i.note.slice(0, 4000),
      })),
    },
  })
}

export function getPayoutBatch(batchId: string) {
  return paypal<PayoutBatch>(`/v1/payments/payouts/${batchId}?fields=items&page_size=100`)
}
