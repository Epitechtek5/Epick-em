import Screen from '@/screens/tournaments/TournamentManagementScreen';
import { withTournamentSource } from '@/components/tournaments/TournamentSourceBoundary';

export default withTournamentSource(Screen, true);
