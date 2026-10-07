import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { CreateTreasuryWizard } from '@/components/CreateTreasuryWizard'

export const metadata = { title: 'Create a treasury — CoTreasury' }

export default function NewTreasuryPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ChevronLeft size={15} /> Home
      </Link>
      <div className="mx-auto mt-6 max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight">Create a treasury</h1>
        <p className="mt-2 text-muted">Five short steps. You can change people and rules later, with the collective&apos;s approval.</p>
      </div>
      <div className="mt-8">
        <CreateTreasuryWizard />
      </div>
    </div>
  )
}
