export function formatMoney(cents: number, currency = 'USD', opts: { cents?: boolean } = {}): string {
  const showCents = opts.cents ?? cents % 100 !== 0
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: showCents ? 2 : 0,
    maximumFractionDigits: showCents ? 2 : 0,
  }).format(cents / 100)
}

export function toCents(dollars: number): number {
  return Math.round(dollars * 100)
}
