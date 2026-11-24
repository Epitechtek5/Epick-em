import Screen from '@/screens/matches/MatchWorkflowScreen';
import { withTournamentSource } from '@/components/tournaments/TournamentSourceBoundary';

export default withTournamentSource(Screen, true);
