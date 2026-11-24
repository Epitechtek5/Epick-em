import { EditTournamentScreen as Screen } from '@/screens/tournaments/TournamentEditorScreen';
import { withTournamentSource } from '@/components/tournaments/TournamentSourceBoundary';

export default withTournamentSource(Screen, true);
