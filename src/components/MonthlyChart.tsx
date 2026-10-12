'use client'

import { useEffect, useMemo, useState } from 'react'
import { AgCharts } from 'ag-charts-react'
import { AllCommunityModule, type AgChartOptions } from 'ag-charts-community'
import { formatMoney } from '@/lib/money'
import type { LedgerRow } from './LedgerGrid'

// Same colours as the ledger: money in green, money out blue, money moved outside CoTreasury red.
const IN = '#0f7b5f'
const OUT = '#2563eb'
const OUTSIDE = '#dc2626'
const MONTHS = 6

type Month = { key: string; month: string; in: number; out: number; outside: number }

/** Confirmed money in and out per month (the last six months with activity), from the same ledger rows as the table. */
function byMonth(entries: LedgerRow[]): Month[] {
  const map = new Map<string, Month>()
  for (const e of entries) {
    if (e.status !== 'CONFIRMED') continue
    const key = e.createdAt.slice(0, 7)
    const m = map.get(key) ?? { key, month: new Date(`${key}-15T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }), in: 0, out: 0, outside: 0 }
    const dollars = e.amountCents / 100
    if (e.type === 'UNAPPROVED_MOVEMENT') m.outside += dollars
    else if (e.direction === 'IN') m.in += dollars
    else m.out += dollars
    map.set(key, m)
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key)).slice(-MONTHS)
}

export function MonthlyChart({ entries, currency }: { entries: LedgerRow[]; currency: string }) {
  const data = useMemo(() => byMonth(entries), [entries])
  const hasOutside = data.some((m) => m.outside > 0)
  // Phones: a shorter chart and no in-bar labels.
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)')
    const update = () => setNarrow(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  const options = useMemo<AgChartOptions>(() => {
    const money = (v: number) => formatMoney(Math.round(v * 100), currency)
    const bar = (yKey: 'in' | 'out' | 'outside', yName: string, fill: string) => ({
      type: 'bar' as const,
      xKey: 'month',
      yKey,
      yName,
      fill,
      cornerRadius: 4,
      tooltip: { renderer: ({ datum }: { datum: Month }) => ({ title: yName, content: `${datum.month}: ${money(datum[yKey])}` }) },
    })
    return {
      data,
      height: narrow ? 220 : 260,
      background: { visible: false },
      padding: { top: 8, right: 8, bottom: 4, left: 4 },
      series: [bar('in', narrow ? 'In' : 'Money in', IN), bar('out', narrow ? 'Out' : 'Money out', OUT), ...(hasOutside ? [bar('outside', narrow ? 'Outside' : 'Outside CoTreasury', OUTSIDE)] : [])],
      axes: {
        x: { type: 'category', position: 'bottom', label: { color: '#6b6b66' }, line: { enabled: false } },
        y: {
          type: 'number',
          position: 'left',
          label: { color: '#8a8984', formatter: ({ value }: { value: number }) => (value >= 1000 ? `$${Math.round(value / 100) / 10}k` : `$${value}`) },
          gridLine: { style: [{ stroke: '#ecebe6', lineDash: [] }] },
        },
      },
      legend: { position: 'top', item: { marker: { shape: 'square', size: narrow ? 8 : 10 }, label: { color: '#52514e', fontSize: narrow ? 11 : 12 }, paddingX: narrow ? 10 : 16 } },
    }
  }, [data, hasOutside, narrow, currency])

  if (data.length === 0) return <div className="card px-5 py-10 text-center text-sm text-muted">No payments yet. The chart fills in as PayPal confirms money in and out.</div>

  return (
    <div className="card px-3 pt-3 pb-2 sm:px-5 sm:pt-4">
      <AgCharts options={options} modules={[AllCommunityModule]} />
      <p className="px-1 pb-1 text-xs text-muted">Confirmed by PayPal. <span className="sm:hidden">Tap</span><span className="hidden sm:inline">Hover over</span> a bar for the exact amount.</p>
    </div>
  )
}
