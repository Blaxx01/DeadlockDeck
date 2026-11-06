/** Kalendertage in lokaler Zeit als „YYYY-MM-DD“ */

export function localDate(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function parseLocalDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(date: string, days: number): string {
  const d = parseLocalDate(date)
  d.setDate(d.getDate() + days)
  return localDate(d)
}

/** Ganze Tage von `from` bis `to` (Sommerzeit-fest) */
export function daysBetween(from: string, to: string): number {
  return Math.round((parseLocalDate(to).getTime() - parseLocalDate(from).getTime()) / 86_400_000)
}
