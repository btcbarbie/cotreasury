'use client'

import { useMemo } from 'react'
import { AgGridReact } from 'ag-grid-react'
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type ICellRendererParams,
  type ValueFormatterParams,
} from 'ag-grid-community'
import { formatMoney } from '@/lib/money'

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
}

type Row = LedgerRow & { balanceCents: number | null }

const theme = themeQuartz.withParams({
  fontFamily: 'inherit',
  fontSize: 13,
  headerFontSize: 12,
  headerFontWeight: 500,
  headerTextColor: '#6b7280',
  headerBackgroundColor: '#ffffff',
  backgroundColor: '#ffffff',
  foregroundColor: '#0e1116',
  borderColor: '#ecece8',
  rowHoverColor: '#fafaf8',
  accentColor: '#0e1116',
  wrapperBorder: false,
  wrapperBorderRadius: 0,
  columnBorder: false,
  headerColumnBorder: false,
  rowHeight: 48,
  headerHeight: 42,
  cellHorizontalPadding: 16,
})

const TYPE_LABEL: Record<string, string> = {
  CONTRIBUTION: 'Contribution',
  PAYOUT: 'Payout',
  REFUND: 'Refund',
  OPENING_BALANCE: 'Opening balance',
  UNAPPROVED_MOVEMENT: 'Unapproved movement',
}

const STATUS_PILL: Record<string, string> = {
  CONFIRMED: 'pill-green',
  PENDING: 'pill-amber',
  FAILED: 'pill-red',
}

const SOURCE_LABEL: Record<string, string> = {
  PAYPAL_WEBHOOK: 'PayPal webhook',
  PAYPAL_API: 'PayPal API',
  IMPORTED: 'Imported',
}

export function LedgerGrid({ entries, currency }: { entries: LedgerRow[]; currency: string }) {
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
        headerName: 'Date',
        width: 120,
        sort: 'desc',
        valueFormatter: (p: ValueFormatterParams<Row, string>) =>
          p.value ? new Date(p.value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '',
      },
      {
        headerName: 'Description',
        flex: 2,
        minWidth: 220,
        valueGetter: (p) => p.data?.memo ?? TYPE_LABEL[p.data?.type ?? ''],
        cellRenderer: (p: ICellRendererParams<Row>) =>
          p.data ? (
            <div className="flex flex-col justify-center leading-tight h-full">
              <span className="truncate">{p.data.memo ?? TYPE_LABEL[p.data.type]}</span>
              <span className="text-[11px] text-muted truncate">
                {TYPE_LABEL[p.data.type]}
                {p.data.counterparty ? ` · ${p.data.counterparty}` : ''}
              </span>
            </div>
          ) : null,
      },
      {
        field: 'amountCents',
        headerName: 'Amount',
        width: 130,
        type: 'rightAligned',
        cellRenderer: (p: ICellRendererParams<Row>) =>
          p.data ? (
            <span className={`tabular font-medium ${p.data.direction === 'IN' ? 'text-accent' : ''}`}>
              {p.data.direction === 'IN' ? '+' : '−'}
              {formatMoney(p.data.amountCents, currency, { cents: true })}
            </span>
          ) : null,
      },
      {
        field: 'status',
        headerName: 'Status',
        width: 120,
        cellRenderer: (p: ICellRendererParams<Row>) =>
          p.value ? <span className={`pill ${STATUS_PILL[p.value] ?? 'pill-gray'}`}>{String(p.value).toLowerCase()}</span> : null,
      },
      {
        field: 'source',
        headerName: 'Verified by',
        width: 140,
        valueFormatter: (p) => SOURCE_LABEL[p.value as string] ?? p.value,
        cellClass: 'text-muted',
      },
      {
        field: 'paypalRef',
        headerName: 'PayPal ref',
        width: 160,
        cellClass: 'font-mono text-[12px] text-muted',
        valueFormatter: (p) => p.value ?? '—',
      },
      {
        field: 'balanceCents',
        headerName: 'Balance',
        width: 130,
        type: 'rightAligned',
        cellClass: 'tabular text-muted',
        valueFormatter: (p) => (p.value == null ? '—' : formatMoney(p.value as number, currency, { cents: true })),
      },
    ],
    [currency],
  )

  return (
    <div className="h-[520px] w-full">
      <AgGridReact<Row>
        theme={theme}
        rowData={rows}
        columnDefs={columnDefs}
        defaultColDef={{ sortable: true, resizable: true, suppressMovable: true }}
        getRowId={(p) => p.data.id}
        suppressCellFocus
        animateRows
      />
    </div>
  )
}
