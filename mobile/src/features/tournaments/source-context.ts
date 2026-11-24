import { createContext, useContext } from 'react';
import type { TournamentSource } from './external';

export const TournamentSourceContext = createContext<TournamentSource | null>(
  null,
);
export const useTournamentSource = () => useContext(TournamentSourceContext);
