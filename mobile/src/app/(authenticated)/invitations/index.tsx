import { Redirect } from 'expo-router';

export default function InvitationsRedirect() {
  return <Redirect href="/(authenticated)/(tabs)/invitations" />;
}
