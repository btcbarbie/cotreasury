import Link from 'next/link'
import { Link2Off } from 'lucide-react'

export default function LinkInvalidPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-20 text-center">
      <span className="mx-auto inline-flex h-11 w-11 items-center justify-center rounded-xl bg-bg text-muted">
        <Link2Off size={20} />
      </span>
      <h1 className="mt-4 text-xl font-semibold">This link no longer works</h1>
      <p className="mt-2 text-sm text-muted">It may have been reset. Ask your treasury’s admin for a new one.</p>
      <Link href="/" className="btn btn-ghost mt-6 inline-flex">Go to CoTreasury</Link>
    </div>
  )
}
