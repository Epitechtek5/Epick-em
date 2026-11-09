function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}

// Date et heure lisibles dans la langue de l'interface (fuseau du navigateur) ; la valeur brute
// est rendue telle quelle si elle n'est pas une date.
export function formatDateTime(lang: string, iso: string | null | undefined): string {
  const date = parse(iso)
  if (!date) return iso ?? ''
  return new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

// Jour seul (ex. « 13 nov. 2026 »).
export function formatDay(lang: string, iso: string | null | undefined): string {
  const date = parse(iso)
  if (!date) return iso ?? ''
  return new Intl.DateTimeFormat(lang, { dateStyle: 'medium' }).format(date)
}

// Période compacte (ex. « 14 – 15 nov. 2026 ») ; heures comprises si le tournoi tient en un jour.
export function formatDateRange(lang: string, start: string, end: string): string {
  const from = parse(start)
  const to = parse(end)
  if (!from || !to) return `${start} – ${end}`
  const sameDay = from.toDateString() === to.toDateString()
  const options: Intl.DateTimeFormatOptions = sameDay
    ? { dateStyle: 'medium', timeStyle: 'short' }
    : { day: 'numeric', month: 'short', year: 'numeric' }
  return new Intl.DateTimeFormat(lang, options).formatRange(from, to)
}

// Points renvoyés par le serveur, sans arrondi trompeur (jusqu'à deux décimales).
export function formatPoints(lang: string, points: number): string {
  return new Intl.NumberFormat(lang, { maximumFractionDigits: 2 }).format(points)
}
