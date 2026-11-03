export function tournamentLocale(language: string) {
  return language.toLowerCase().startsWith('fr') ? 'fr-FR' : 'en-GB';
}

export function formatTournamentDate(value: string, language: string) {
  return new Intl.DateTimeFormat(tournamentLocale(language), {
    dateStyle: 'medium',
    timeStyle: 'short',
    hour12: false,
  }).format(new Date(value));
}
