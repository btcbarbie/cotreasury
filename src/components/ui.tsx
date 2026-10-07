const AVATAR_TONES = ['#e7f4ef', '#eaf0fd', '#fdf3e2', '#f3eafd', '#fdeaf2', '#eef2f0']

export function Avatar({ name, size = 30 }: { name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
  const tone = AVATAR_TONES[[...name].reduce((s, c) => s + c.charCodeAt(0), 0) % AVATAR_TONES.length]
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-medium text-ink/80"
      style={{ width: size, height: size, background: tone, fontSize: size * 0.38 }}
    >
      {initials}
    </span>
  )
}

const ROLE_LABEL: Record<string, string> = { ADMIN: 'Admin', APPROVER: 'Approver', MEMBER: 'Member' }

export function RoleBadge({ role }: { role: string }) {
  if (role === 'MEMBER') return <span className="text-xs text-muted">Member</span>
  return <span className={`pill ${role === 'ADMIN' ? 'pill-blue' : 'pill-green'} !h-[18px] !text-[11px]`}>{ROLE_LABEL[role]}</span>
}
