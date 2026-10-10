import { randomUUID } from 'crypto'
import { paypalRecipient } from './recipients'

// Thin server-side PayPal REST client. Credentials never reach the browser
// except the public client id used by the JS SDK.

// Sandbox only, by design. There is deliberately no switch to live PayPal.
const BASE = 'https://api-m.sandbox.paypal.com'

// ---------- Which PayPal account (per group) ----------
//
// Each group can have its own sandbox business account. Its credentials live in
// env under a short key: PAYPAL_CLIENT_ID_<KEY>, PAYPAL_CLIENT_SECRET_<KEY> and
// PAYPAL_WEBHOOK_ID_<KEY> (e.g. KEY = LISBON). Without them, the group falls
// back to the shared account in PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET.

/** A group's account key, or null for the shared account. */
export type Account = string | null | undefined

const suffix = (key: string) => `_${key.toUpperCase().replace(/[^A-Z0-9]/g, '')}`

/** True when this key has its own credentials configured (not falling back to the shared account). */
export function hasOwnAccount(account: Account): account is string {
  return !!account && !!process.env[`PAYPAL_CLIENT_ID${suffix(account)}`] && !!process.env[`PAYPAL_CLIENT_SECRET${suffix(account)}`]
}

function credentials(account: Account) {
  const key = hasOwnAccount(account) ? suffix(account) : ''
  return {
    cacheKey: key || 'shared',
    id: process.env[`PAYPAL_CLIENT_ID${key}`],
    secret: process.env[`PAYPAL_CLIENT_SECRET${key}`],
    webhookId: process.env[`PAYPAL_WEBHOOK_ID${key}`],
  }
}

/** The public client id for the PayPal button (safe to send to the browser). */
export function publicClientId(account: Account) {
  return credentials(account).id ?? ''
}

const tokens = new Map<string, { token: string; expiresAt: number }>()

async function accessToken(account: Account): Promise<string> {
  const c = credentials(account)
  const cached = tokens.get(c.cacheKey)
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token
  if (!c.id || !c.secret) throw new Error('PayPal credentials are not set')

  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${c.id}:${c.secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    cache: 'no-store',
  })
  if (!res.ok) throw new PayPalError('Could not authenticate with PayPal', res.status, await res.text())
  const data = (await res.json()) as { access_token: string; expires_in: number }
  tokens.set(c.cacheKey, { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 })
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
  init: { method?: string; body?: unknown; rawJson?: string; requestId?: string; prefer?: string; account?: Account } = {},
  attempt = 0,
): Promise<T> {
  const method = init.method ?? 'GET'
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await accessToken(init.account)}`,
    'Content-Type': 'application/json',
  }
  // Idempotency: retries with the same request id never double-charge or double-pay.
  if (method === 'POST') headers['PayPal-Request-Id'] = init.requestId ?? randomUUID()
  if (init.prefer) headers['Prefer'] = init.prefer

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

export function createOrder(opts: { amountCents: number; currency: string; customId: string; description: string }, account?: Account) {
  return paypal<PayPalOrder>('/v2/checkout/orders', {
    method: 'POST',
    account,
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

export function captureOrder(orderId: string, account?: Account) {
  // Request id derived from the order: a retried capture is a no-op, never a second charge.
  return paypal<PayPalOrder>(`/v2/checkout/orders/${orderId}/capture`, {
    method: 'POST',
    account,
    requestId: `capture-${orderId}`,
  })
}

export function getCapture(captureId: string, account?: Account) {
  return paypal<PayPalCapture>(`/v2/payments/captures/${captureId}`, { account })
}

// ---------- Webhooks ----------

/** Every account with a webhook configured: the shared one plus each PAYPAL_WEBHOOK_ID_<KEY>. */
function webhookAccounts(): (string | null)[] {
  const keys = Object.keys(process.env)
    .filter((k) => k.startsWith('PAYPAL_WEBHOOK_ID_') && process.env[k])
    .map((k) => k.slice('PAYPAL_WEBHOOK_ID_'.length))
    .filter((key) => hasOwnAccount(key))
  return [...(process.env.PAYPAL_WEBHOOK_ID ? [null] : []), ...keys]
}

/**
 * Check a webhook really came from PayPal. Each group's PayPal app has its own
 * webhook, so try each configured account. Returns the account it came from
 * (null = shared), or false if no account recognises the signature.
 */
export async function verifyWebhookSignature(headers: Headers, rawBody: string): Promise<string | null | false> {
  const accounts = webhookAccounts()
  if (accounts.length === 0) throw new Error('No PAYPAL_WEBHOOK_ID is set')
  const h = (name: string) => headers.get(name) ?? ''
  for (const account of accounts) {
    const fields = JSON.stringify({
      auth_algo: h('paypal-auth-algo'),
      cert_url: h('paypal-cert-url'),
      transmission_id: h('paypal-transmission-id'),
      transmission_sig: h('paypal-transmission-sig'),
      transmission_time: h('paypal-transmission-time'),
      webhook_id: credentials(account).webhookId,
    })
    // Splice in the exact bytes PayPal sent: re-serializing the event can change
    // number/whitespace formatting and make a genuine signature fail.
    const rawJson = `${fields.slice(0, -1)},"webhook_event":${rawBody}}`
    try {
      const result = await paypal<{ verification_status: string }>('/v1/notifications/verify-webhook-signature', { method: 'POST', rawJson, account })
      if (result.verification_status === 'SUCCESS') return account
    } catch {
      // Not this account's webhook; try the next.
    }
  }
  return false
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

export function createPayoutBatch(
  opts: {
    senderBatchId: string
    subject: string
    message: string
    currency: string
    items: { senderItemId: string; receiver: string; recipientType: string; amountCents: number; note: string }[]
  },
  account?: Account,
) {
  return paypal<PayoutBatch>('/v1/payments/payouts', {
    method: 'POST',
    account,
    // sender_batch_id is PayPal's own duplicate guard; the request id makes HTTP retries safe too.
    requestId: `payout-${opts.senderBatchId}`,
    body: {
      sender_batch_header: {
        sender_batch_id: opts.senderBatchId,
        email_subject: opts.subject.slice(0, 255),
        email_message: opts.message.slice(0, 1000),
      },
      items: opts.items.map((i) => ({
        ...paypalRecipient(i.recipientType, i.receiver),
        amount: { value: (i.amountCents / 100).toFixed(2), currency: opts.currency },
        sender_item_id: i.senderItemId,
        note: i.note.slice(0, 4000),
      })),
    },
  })
}

export function getPayoutBatch(batchId: string, account?: Account) {
  return paypal<PayoutBatch>(`/v1/payments/payouts/${batchId}?fields=items&page_size=100`, { account })
}

export type PayoutItemDetail = PayoutItem & {
  payout_item_fee?: { value: string; currency: string }
  time_processed?: string
}

export function getPayoutItem(itemId: string, account?: Account) {
  return paypal<PayoutItemDetail>(`/v1/payments/payouts-item/${itemId}`, { account })
}

export type CaptureDetail = PayPalCapture & {
  create_time?: string
  update_time?: string
  seller_receivable_breakdown?: {
    gross_amount?: { value: string; currency_code: string }
    paypal_fee?: { value: string; currency_code: string }
    net_amount?: { value: string; currency_code: string }
  }
  supplementary_data?: { related_ids?: { order_id?: string } }
}

export function getCaptureDetail(captureId: string, account?: Account) {
  return paypal<CaptureDetail>(`/v2/payments/captures/${captureId}`, { account })
}

// ---------- Which PayPal account actually holds the money ----------

const merchants = new Map<string, Promise<{ email: string | null; merchantId: string | null }>>()

/**
 * The sandbox business account these API credentials belong to: where
 * contributions land and payouts leave from. PayPal reports it as the payee on
 * any order, so we create one (never captured; it simply expires) and remember
 * the answer for the life of the server.
 */
export function getMerchantAccount(account?: Account) {
  const key = credentials(account).cacheKey
  let found = merchants.get(key)
  if (!found) {
    found = paypal<{ purchase_units: { payee?: { email_address?: string; merchant_id?: string } }[] }>('/v2/checkout/orders', {
      method: 'POST',
      account,
      requestId: `cotreasury-merchant-lookup-${key}`,
      prefer: 'return=representation',
      body: { intent: 'CAPTURE', purchase_units: [{ amount: { currency_code: 'USD', value: '1.00' }, description: 'Account lookup (never captured)' }] },
    })
      .then((o) => ({ email: o.purchase_units[0]?.payee?.email_address ?? null, merchantId: o.purchase_units[0]?.payee?.merchant_id ?? null }))
      .catch(() => {
        merchants.delete(key) // try again next time
        return { email: null, merchantId: null }
      })
    merchants.set(key, found)
  }
  return found
}

// ---------- Transaction Search (the account's full history) ----------

export type AccountTransaction = {
  transaction_info: {
    transaction_id: string
    transaction_event_code: string
    transaction_initiation_date: string
    transaction_amount: { currency_code: string; value: string }
    transaction_status: string
    transaction_subject?: string
    transaction_note?: string
  }
  payer_info?: { email_address?: string; payer_name?: { alternate_full_name?: string } }
}

/**
 * Everything that happened in the PayPal account between two dates, including
 * activity done directly in PayPal (outside CoTreasury). PayPal allows at most
 * 31 days per request.
 */
export async function searchTransactions(start: Date, end: Date, account?: Account) {
  const out: AccountTransaction[] = []
  for (let page = 1; page <= 5; page++) {
    const q = new URLSearchParams({
      start_date: `${start.toISOString().slice(0, 19)}Z`,
      end_date: `${end.toISOString().slice(0, 19)}Z`,
      fields: 'transaction_info,payer_info',
      page_size: '100',
      page: String(page),
    })
    const r = await paypal<{ transaction_details?: AccountTransaction[]; total_pages?: number }>(`/v1/reporting/transactions?${q}`, { account })
    out.push(...(r.transaction_details ?? []))
    if (!r.total_pages || page >= r.total_pages) break
  }
  return out
}
