import { CreateTournamentTeamScreen as Screen } from '@/screens/teams/TeamEditorScreen';
import { withTournamentSource } from '@/components/tournaments/TournamentSourceBoundary';

export default withTournamentSource(Screen, true);
