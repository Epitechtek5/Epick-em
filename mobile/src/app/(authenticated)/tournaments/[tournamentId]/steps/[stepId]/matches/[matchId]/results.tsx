import Screen from '@/screens/matches/MatchResultsScreen';
import { withTournamentSource } from '@/components/tournaments/TournamentSourceBoundary';

export default withTournamentSource(Screen, true);
