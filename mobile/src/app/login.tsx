import { Link } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';

import { AuthHeader } from '@/components/auth-header';

export default function LoginScreen() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerClassName="flex-grow justify-center px-6 py-12"
        keyboardShouldPersistTaps="handled"
      >
        <View className="mx-auto w-full max-w-md gap-6">
          <AuthHeader
            title="Welcome back"
            description="Sign in to your Epick'em account."
          />

          <View className="gap-4">
            <View className="gap-2">
              <Text nativeID="login-username-label">Username</Text>
              <Input
                accessibilityLabel="Username"
                accessibilityLabelledBy="login-username-label"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="username"
                value={username}
                onChangeText={setUsername}
              />
            </View>

            <View className="gap-2">
              <Text nativeID="login-password-label">Password</Text>
              <Input
                accessibilityLabel="Password"
                accessibilityLabelledBy="login-password-label"
                secureTextEntry
                autoComplete="current-password"
                value={password}
                onChangeText={setPassword}
              />
            </View>

            <Button disabled accessibilityLabel="Sign in unavailable">
              <Text>Sign in</Text>
            </Button>

            <Text className="text-center text-sm text-muted-foreground">
              Authentication will be available when the backend JWT endpoints
              are implemented.
            </Text>
          </View>

          <View className="flex-row flex-wrap justify-center gap-1">
            <Text className="text-muted-foreground">
              Don&apos;t have an account?
            </Text>
            <Link href="/register">
              <Text className="font-semibold text-primary">Create one</Text>
            </Link>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
