'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AgGridReact } from 'ag-grid-react'
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type ICellRendererParams,
  type GridApi,
  type ProcessCellForExportParams,
  type IRowNode,
  type RowClassParams,
} from 'ag-grid-community'
import { AlertTriangle, Download, Receipt as ReceiptIcon, Search } from 'lucide-react'
import { formatMoney } from '@/lib/money'
import { Avatar } from './ui'
import { ReceiptDialog } from './ReceiptDialog'

ModuleRegistry.registerModules([AllCommunityModule])

export type LedgerRow = {
  id: string
  createdAt: string
  type: string
  direction: string
  amountCents: number
  status: string
  source: string
  memo: string | null
  counterparty: string | null
  paypalRef: string | null
  requestedBy: string | null
  approvedBy: string[]
}

type Row = LedgerRow & { balanceCents: number | null; totals?: Totals }
type Totals = { count: number; inCents: number; outCents: number }
type GridContext = { currency: string }

/** Pinned bottom row: totals of whatever the filters and search currently show (confirmed money only). */
function TotalsCell(p: ICellRendererParams<Row, unknown, GridContext>) {
  const { currency } = p.context
  const totals = p.data?.totals ?? { count: 0, inCents: 0, outCents: 0 }
  const col = p.column?.getColId()
  if (col === 'entry')
    return (
      <div className="flex h-full flex-col justify-center leading-tight">
        <span className="font-semibold">Totals</span>
        <span className="text-xs text-muted">
          {totals.count} entr{totals.count === 1 ? 'y' : 'ies'} shown · confirmed money only
        </span>
      </div>
    )
  if (col === 'status')
    return (
      <div className="flex h-full flex-col justify-center text-xs leading-tight text-muted">
        <span>
          Money in <span className="tabular font-semibold text-accent">{formatMoney(totals.inCents, currency)}</span>
        </span>
        <span>
          Money out <span className="tabular font-semibold text-blue">{formatMoney(totals.outCents, currency)}</span>
        </span>
      </div>
    )
  if (col === 'amountCents') {
    const net = totals.inCents - totals.outCents
    return (
      <div className="flex h-full flex-col items-end justify-center leading-tight">
        <span className={`tabular font-semibold ${net >= 0 ? 'text-accent' : 'text-red'}`}>
          {net >= 0 ? '+' : '−'}
          {formatMoney(Math.abs(net), currency)}
        </span>
        <span className="text-[11px] text-muted">net</span>
      </div>
    )
  }
  return null
}

function sumFiltered(api: GridApi<Row>): Totals {
  const t: Totals = { count: 0, inCents: 0, outCents: 0 }
  api.forEachNodeAfterFilter((n) => {
    const r = n.data
    if (!r) return
    t.count++
    if (r.status !== 'CONFIRMED') return
    if (r.direction === 'IN') t.inCents += r.amountCents
    else t.outCents += r.amountCents
  })
  return t
}
type Filter = 'ALL' | 'IN' | 'OUT'

const theme = themeQuartz.withParams({
  fontFamily: 'inherit',
  fontSize: 14,
  headerFontSize: 11,
  headerFontWeight: 600,
  headerTextColor: '#6b7280',
  headerBackgroundColor: '#fafaf8',
  backgroundColor: '#ffffff',
  foregroundColor: '#0e1116',
  borderColor: '#ecece8',
  rowHoverColor: '#fafaf8',
  accentColor: '#0e1116',
  wrapperBorder: false,
  wrapperBorderRadius: 0,
  columnBorder: false,
  headerColumnBorder: false,
  rowHeight: 68,
  headerHeight: 44,
  cellHorizontalPadding: 18,
})

const TYPE_LABEL: Record<string, string> = {
  CONTRIBUTION: 'Contribution',
  PAYOUT: 'Payout',
  REFUND: 'Refund',
  OPENING_BALANCE: 'Opening balance',
  UNAPPROVED_MOVEMENT: 'Unapproved movement',
}

function payee(counterparty: string | null) {
  // Payout counterparties are stored as "Name · email"; show the name as the entry.
  return counterparty?.split(' · ')[0] ?? null
}

/** Who moved the money, who allowed it, and who confirmed it, in one cell. */
function StatusCell({ r }: { r: Row }) {
  if (r.type === 'UNAPPROVED_MOVEMENT') {
    return (
      <div className="flex h-full flex-col justify-center leading-tight">
        <span className="pill pill-red w-fit">
          <AlertTriangle size={11} /> Not approved
        </span>
        <span className="mt-1 text-[11px] text-red">Moved in PayPal without the collective</span>
      </div>
    )
  }
  const pill =
    // Same colour as the amount: money in green, money out blue.
    r.status === 'CONFIRMED' ? { cls: r.direction === 'IN' ? 'pill-green' : 'pill-blue', label: r.source === 'IMPORTED' ? 'Recorded' : 'Verified' } : r.status === 'FAILED' ? { cls: 'pill-red', label: 'Failed' } : { cls: 'pill-amber', label: 'Pending' }
  let line: string | null
  if (r.source === 'IMPORTED') line = null
  else if (r.type === 'PAYOUT') {
    const approvers = r.approvedBy.length ? r.approvedBy.map((n) => n.split(' ')[0]).join(', ') : 'nobody'
    line = `Requested by ${r.requestedBy?.split(' ')[0] ?? 'unknown'} · approved by ${approvers}`
  } else if (r.status === 'CONFIRMED') line = `by PayPal ${r.source === 'PAYPAL_WEBHOOK' ? '(signed webhook)' : '(status check)'}`
  else if (r.status === 'PENDING') line = 'Waiting for PayPal to confirm'
  else line = 'PayPal declined it'
  return (
    <div className="flex h-full flex-col justify-center leading-tight">
      <span className={`pill ${pill.cls} w-fit`}>
        <span className="h-1.5 w-1.5 rounded-full bg-current" /> {pill.label}
      </span>
      {line && (
        <span className="mt-1 truncate text-[11px] text-muted" title={line}>
          {line}
        </span>
      )}
    </div>
  )
}

export function LedgerGrid({ entries, currency }: { entries: LedgerRow[]; currency: string }) {
  const gridRef = useRef<AgGridReact<Row>>(null)
  const [filter, setFilter] = useState<Filter>('ALL')
  const [search, setSearch] = useState('')
  const [receiptFor, setReceiptFor] = useState<Row | null>(null)
  const [totals, setTotals] = useState<Totals>({ count: 0, inCents: 0, outCents: 0 })
  // Phones: drop date, status and balance columns so the amount stays on screen; the date moves under the name.
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)')
    const update = () => setNarrow(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  // Only update when the numbers change, so re-rendering the pinned row can't loop.
  const recalc = (api: GridApi<Row>) => {
    const t = sumFiltered(api)
    setTotals((prev) => (prev.count === t.count && prev.inCents === t.inCents && prev.outCents === t.outCents ? prev : t))
  }

  // Running balance over confirmed entries only, oldest → newest, then shown newest first.
  const rows = useMemo<Row[]>(() => {
    const asc = [...entries].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    const withBal: Row[] = []
    let bal = 0
    for (const e of asc) {
      if (e.status !== 'CONFIRMED') {
        withBal.push({ ...e, balanceCents: null })
        continue
      }
      bal += e.direction === 'IN' ? e.amountCents : -e.amountCents
      withBal.push({ ...e, balanceCents: bal })
    }
    return withBal.reverse()
  }, [entries])

  const columnDefs = useMemo<ColDef<Row>[]>(
    () => [
      {
        field: 'createdAt',
        headerName: 'DATE',
        width: 110,
        sort: 'desc',
        hide: narrow,
        cellRenderer: (p: ICellRendererParams<Row>) => {
          const d = new Date(p.value as string)
          return (
            <div className="flex h-full flex-col justify-center leading-tight">
              <span className="font-medium">{d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}</span>
              <span className="text-xs text-muted">{d.getFullYear()}</span>
            </div>
          )
        },
      },
      {
        colId: 'entry',
        headerName: 'ENTRY',
        flex: 2,
        minWidth: narrow ? 150 : 240,
        // Searchable text for the quick filter: name + description.
        valueGetter: (p) => `${payee(p.data?.counterparty ?? null) ?? ''} ${p.data?.memo ?? ''} ${TYPE_LABEL[p.data?.type ?? ''] ?? ''}`,
        cellRenderer: (p: ICellRendererParams<Row>) => {
          const r = p.data
          if (!r) return null
          const who = r.type === 'OPENING_BALANCE' ? 'Opening balance' : (payee(r.counterparty) ?? TYPE_LABEL[r.type])
          const what =
            r.type === 'PAYOUT'
              ? `Paid out: ${r.memo ?? 'approved request'}`
              : r.type === 'OPENING_BALANCE'
                ? (r.memo ?? 'Carried over')
                : (r.memo ?? TYPE_LABEL[r.type])
          const when = narrow ? `${new Date(r.createdAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}${r.status === 'PENDING' ? ' · Pending' : r.status === 'FAILED' ? ' · Failed' : ''} · ` : ''
          return (
            <div className="flex h-full items-center gap-3">
              <Avatar name={who} size={narrow ? 28 : 34} />
              <div className="min-w-0 leading-tight">
                <div className="truncate font-medium">{who}</div>
                <div className="truncate text-xs text-muted">{when}{what}</div>
              </div>
            </div>
          )
        },
      },
      { colId: 'status', headerName: 'STATUS', width: 260, hide: narrow, cellRenderer: (p: ICellRendererParams<Row>) => (p.data ? <StatusCell r={p.data} /> : null) },
      {
        field: 'amountCents',
        headerName: 'AMOUNT',
        width: narrow ? 108 : 130,
        type: 'rightAligned',
        cellRenderer: (p: ICellRendererParams<Row>) =>
          p.data ? (
            // Money in green, money out blue, money moved outside CoTreasury red.
            <span className={`tabular font-semibold ${p.data.type === 'UNAPPROVED_MOVEMENT' ? 'text-red' : p.data.direction === 'IN' ? 'text-accent' : 'text-blue'} ${p.data.status === 'FAILED' ? 'line-through opacity-50' : ''}`}>
              {p.data.direction === 'IN' ? '+' : '−'}
              {formatMoney(p.data.amountCents, currency)}
            </span>
          ) : null,
      },
      {
        field: 'balanceCents',
        headerName: 'BALANCE AFTER',
        width: 140,
        hide: narrow,
        type: 'rightAligned',
        cellRenderer: (p: ICellRendererParams<Row>) =>
          p.value == null ? <span className="text-xs text-faint">not counted yet</span> : <span className="tabular font-medium">{formatMoney(p.value as number, currency)}</span>,
      },
      {
        colId: 'receipt',
        headerName: narrow ? '' : 'RECEIPT',
        width: narrow ? 56 : 100,
        cellRenderer: (p: ICellRendererParams<Row>) => {
          const r = p.data
          if (!r) return null
          const available = !!r.paypalRef && r.source !== 'IMPORTED'
          return (
            <div className="flex h-full items-center">
              <button
                onClick={() => setReceiptFor(r)}
                title={available ? 'Open the PayPal receipt' : 'See what was recorded'}
                className={`inline-flex h-9 w-9 items-center justify-center rounded-lg transition ${available ? 'bg-blue-soft text-blue hover:bg-blue hover:text-white' : 'bg-bg text-faint hover:text-ink'}`}
                aria-label="Open receipt"
              >
                <ReceiptIcon size={16} />
              </button>
            </div>
          )
        },
      },
    ],
    [currency, narrow],
  )

  // The pinned row carries the current totals; AG Grid re-renders it when they change.
  const pinnedBottom = useMemo(() => [{ id: '__totals', totals } as Row], [totals])

  function exportCsv() {
    const stamp = new Date().toISOString().slice(0, 10)
    gridRef.current?.api.exportDataAsCsv({
      fileName: `ledger-${stamp}.csv`,
      skipPinnedBottom: true,
      processHeaderCallback: (p) => (p.column.getColId() === 'receipt' ? 'PAYPAL REFERENCE' : (p.column.getColDef().headerName ?? '')),
      // Export plain values (ISO dates, signed amounts, PayPal ids) rather than what the cells draw.
      processCellCallback: (p: ProcessCellForExportParams<Row>) => {
        const r = p.node?.data
        if (!r) return ''
        switch (p.column.getColId()) {
          case 'createdAt':
            return r.createdAt.slice(0, 10)
          case 'entry':
            return `${payee(r.counterparty) ?? TYPE_LABEL[r.type]}: ${r.type === 'PAYOUT' ? `Paid out: ${r.memo ?? ''}` : (r.memo ?? TYPE_LABEL[r.type])}`
          case 'status':
            return [
              r.type === 'UNAPPROVED_MOVEMENT' ? 'NOT APPROVED' : r.status,
              r.type === 'PAYOUT' && r.requestedBy ? `requested by ${r.requestedBy}` : '',
              r.type === 'PAYOUT' && r.approvedBy.length ? `approved by ${r.approvedBy.join(' & ')}` : '',
              r.source === 'IMPORTED' ? 'imported record' : r.source === 'PAYPAL_WEBHOOK' ? 'confirmed by PayPal webhook' : 'confirmed by PayPal API',
            ]
              .filter(Boolean)
              .join('; ')
          case 'amountCents':
            return ((r.direction === 'IN' ? 1 : -1) * r.amountCents / 100).toFixed(2)
          case 'balanceCents':
            return r.balanceCents == null ? '' : (r.balanceCents / 100).toFixed(2)
          case 'receipt':
            return r.paypalRef ?? ''
          default:
            return String(p.value ?? '')
        }
      },
    })
  }

  const counts = { ALL: rows.length, IN: rows.filter((r) => r.direction === 'IN').length, OUT: rows.filter((r) => r.direction === 'OUT').length }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
        {(['ALL', 'IN', 'OUT'] as const).map((f) => (
          <button
            key={f}
            onClick={() => {
              setFilter(f)
              // AG Grid re-reads the external filter on request.
              setTimeout(() => gridRef.current?.api.onFilterChanged())
            }}
            className={`h-8 rounded-full px-3.5 text-sm font-medium transition ${filter === f ? 'bg-ink text-white' : 'text-muted ring-1 ring-line-strong hover:text-ink'}`}
          >
            {f === 'ALL' ? 'All' : f === 'IN' ? 'Money in' : 'Money out'}
            <span className="tabular ml-1.5 text-xs opacity-60">{counts[f]}</span>
          </button>
        ))}
        <div className="ml-auto flex w-full items-center gap-2 sm:w-auto">
        <div className="relative w-full sm:w-72">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input className="input !h-8 rounded-full pl-8" placeholder="Search a name or purpose" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <button className="btn btn-ghost !h-8 shrink-0 rounded-full !px-3 text-sm" onClick={exportCsv} title="Download what's shown as a CSV file">
          <Download size={14} /> Export CSV
        </button>
        </div>
      </div>
      <div className="h-[560px] w-full">
        <AgGridReact<Row>
          ref={gridRef}
          context={{ currency } satisfies GridContext}
          pinnedBottomRowData={pinnedBottom}
          onGridReady={(e) => recalc(e.api)}
          onModelUpdated={(e) => recalc(e.api)}
          theme={theme}
          rowData={rows}
          columnDefs={columnDefs}
          defaultColDef={{
            sortable: true,
            resizable: true,
            suppressMovable: true,
            cellRendererSelector: (p) => (p.node.rowPinned ? { component: TotalsCell } : undefined),
          }}
          getRowId={(p) => p.data.id}
          quickFilterText={search}
          isExternalFilterPresent={() => filter !== 'ALL'}
          doesExternalFilterPass={(n: IRowNode<Row>) => n.data?.direction === filter}
          getRowStyle={(p: RowClassParams<Row>) =>
            p.data?.type === 'UNAPPROVED_MOVEMENT' ? { background: 'var(--red-soft)', boxShadow: 'inset 3px 0 0 var(--red)' } : undefined
          }
          suppressCellFocus
          animateRows
        />
      </div>
      {receiptFor && (
        <ReceiptDialog
          entryId={receiptFor.id}
          title={payee(receiptFor.counterparty) ?? TYPE_LABEL[receiptFor.type]}
          recorded={
            receiptFor.paypalRef && receiptFor.source !== 'IMPORTED' && receiptFor.type !== 'UNAPPROVED_MOVEMENT'
              ? undefined
              : {
                  kind: TYPE_LABEL[receiptFor.type] ?? receiptFor.type,
                  amount: formatMoney(receiptFor.amountCents, currency, { cents: true }),
                  date: new Date(receiptFor.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
                  counterparty: receiptFor.counterparty,
                  memo: receiptFor.memo,
                  status: receiptFor.status === 'CONFIRMED' ? 'Confirmed' : receiptFor.status === 'PENDING' ? 'Pending' : 'Failed',
                  note:
                    receiptFor.type === 'UNAPPROVED_MOVEMENT'
                      ? receiptFor.paypalRef
                        ? `Found in PayPal’s own history of the group’s account (transaction ${receiptFor.paypalRef}). It wasn’t made through CoTreasury, so nobody requested or approved it here.`
                        : 'Money that moved in the group’s PayPal account outside CoTreasury, so nobody requested or approved it here. It still counts in the balance: the money really left.'
                      : undefined,
                }
          }
          askPrompt={`Explain this ledger entry: the ${(TYPE_LABEL[receiptFor.type] ?? receiptFor.type).toLowerCase()} of ${formatMoney(receiptFor.amountCents, currency, { cents: true })}${
            receiptFor.counterparty ? ` (${payee(receiptFor.counterparty)})` : ''
          } on ${new Date(receiptFor.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}${receiptFor.memo ? `, "${receiptFor.memo}"` : ''}. Who asked for it, who approved it, and how was it confirmed?`}
          onClose={() => setReceiptFor(null)}
        />
      )}
    </div>
  )
}
