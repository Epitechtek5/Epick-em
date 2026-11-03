// Date et heure lisibles dans la langue de l'interface (fuseau du navigateur) ; la valeur brute
// est rendue telle quelle si elle n'est pas une date.
export function formatDateTime(lang: string, iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? iso
    : new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

// Points renvoyés par le serveur, sans arrondi trompeur (jusqu'à deux décimales).
export function formatPoints(lang: string, points: number): string {
  return new Intl.NumberFormat(lang, { maximumFractionDigits: 2 }).format(points)
}
