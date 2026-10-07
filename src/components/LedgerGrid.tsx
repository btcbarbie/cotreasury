'use client'

import { useMemo, useRef, useState } from 'react'
import { AgGridReact } from 'ag-grid-react'
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type ICellRendererParams,
  type IRowNode,
  type RowClassParams,
} from 'ag-grid-community'
import { AlertTriangle, Receipt as ReceiptIcon, Search } from 'lucide-react'
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

type Row = LedgerRow & { balanceCents: number | null }
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
    r.status === 'CONFIRMED' ? { cls: 'pill-green', label: r.source === 'IMPORTED' ? 'Recorded' : 'Verified' } : r.status === 'FAILED' ? { cls: 'pill-red', label: 'Failed' } : { cls: 'pill-amber', label: 'Pending' }
  let line: string
  if (r.source === 'IMPORTED') line = 'Imported from earlier records'
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
      <span className="mt-1 truncate text-[11px] text-muted" title={line}>
        {line}
      </span>
    </div>
  )
}

export function LedgerGrid({ entries, currency }: { entries: LedgerRow[]; currency: string }) {
  const gridRef = useRef<AgGridReact<Row>>(null)
  const [filter, setFilter] = useState<Filter>('ALL')
  const [search, setSearch] = useState('')
  const [receiptFor, setReceiptFor] = useState<Row | null>(null)

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
        minWidth: 240,
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
          return (
            <div className="flex h-full items-center gap-3">
              <Avatar name={who} size={34} />
              <div className="min-w-0 leading-tight">
                <div className="truncate font-medium">{who}</div>
                <div className="truncate text-xs text-muted">{what}</div>
              </div>
            </div>
          )
        },
      },
      { colId: 'status', headerName: 'STATUS', width: 260, cellRenderer: (p: ICellRendererParams<Row>) => (p.data ? <StatusCell r={p.data} /> : null) },
      {
        field: 'amountCents',
        headerName: 'AMOUNT',
        width: 130,
        type: 'rightAligned',
        cellRenderer: (p: ICellRendererParams<Row>) =>
          p.data ? (
            <span className={`tabular font-semibold ${p.data.type === 'UNAPPROVED_MOVEMENT' ? 'text-red' : p.data.direction === 'IN' ? 'text-accent' : ''} ${p.data.status === 'FAILED' ? 'line-through opacity-50' : ''}`}>
              {p.data.direction === 'IN' ? '+' : '−'}
              {formatMoney(p.data.amountCents, currency)}
            </span>
          ) : null,
      },
      {
        field: 'balanceCents',
        headerName: 'BALANCE AFTER',
        width: 140,
        type: 'rightAligned',
        cellRenderer: (p: ICellRendererParams<Row>) =>
          p.value == null ? <span className="text-xs text-faint">not counted yet</span> : <span className="tabular font-medium">{formatMoney(p.value as number, currency)}</span>,
      },
      {
        colId: 'receipt',
        headerName: 'RECEIPT',
        width: 100,
        cellRenderer: (p: ICellRendererParams<Row>) => {
          const r = p.data
          if (!r) return null
          const available = !!r.paypalRef && r.source !== 'IMPORTED'
          return (
            <div className="flex h-full items-center">
              <button
                onClick={() => available && setReceiptFor(r)}
                disabled={!available}
                title={available ? 'Open the PayPal receipt' : 'Imported record: no PayPal receipt'}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-blue-soft text-blue transition hover:bg-blue hover:text-white disabled:bg-bg disabled:text-faint"
                aria-label="Open receipt"
              >
                <ReceiptIcon size={16} />
              </button>
            </div>
          )
        },
      },
    ],
    [currency],
  )

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
        <div className="relative ml-auto w-full sm:w-72">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input className="input !h-8 rounded-full pl-8" placeholder="Search a name or purpose" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      <div className="h-[560px] w-full">
        <AgGridReact<Row>
          ref={gridRef}
          theme={theme}
          rowData={rows}
          columnDefs={columnDefs}
          defaultColDef={{ sortable: true, resizable: true, suppressMovable: true }}
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
      {receiptFor && <ReceiptDialog entryId={receiptFor.id} title={payee(receiptFor.counterparty) ?? TYPE_LABEL[receiptFor.type]} onClose={() => setReceiptFor(null)} />}
    </div>
  )
}
