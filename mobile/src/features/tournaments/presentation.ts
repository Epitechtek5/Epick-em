export function tournamentLocale(language: string) {
  if (language.toLowerCase().startsWith('fr')) return 'fr-FR';
  if (language.toLowerCase().startsWith('es')) return 'es-ES';
  return 'en-GB';
}

export function formatTournamentDate(value: string, language: string) {
  return new Intl.DateTimeFormat(tournamentLocale(language), {
    dateStyle: 'medium',
    timeStyle: 'short',
    hour12: false,
  }).format(new Date(value));
}
