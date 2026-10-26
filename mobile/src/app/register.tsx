import { Link } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  View,
} from 'react-native';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { ApiError } from '@/lib/api';
import { register } from '@/features/auth/register';
import {
  validateRegisterForm,
  type RegisterErrors,
  type RegisterForm,
} from '@/features/auth/validation';

import { AuthHeader } from '@/components/auth-header';

const INITIAL_FORM: RegisterForm = {
  username: '',
  password: '',
  confirmPassword: '',
};

export default function RegisterScreen() {
  const [form, setForm] = useState<RegisterForm>(INITIAL_FORM);
  const [errors, setErrors] = useState<RegisterErrors>({});
  const [serverError, setServerError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [created, setCreated] = useState(false);

  function updateField(field: keyof RegisterForm, value: string) {
    setForm((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => ({ ...previous, [field]: undefined }));
    setServerError('');
  }

  async function handleSubmit() {
    if (isSubmitting) return;

    const validationErrors = validateRegisterForm(form);
    setErrors(validationErrors);
    setServerError('');

    if (Object.keys(validationErrors).length > 0) return;

    setIsSubmitting(true);

    try {
      await register({
        username: form.username,
        password: form.password,
      });

      setCreated(true);
      setForm(INITIAL_FORM);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setErrors({ username: 'This username is already taken.' });
      } else if (error instanceof ApiError) {
        setServerError(error.message);
      } else {
        console.error('Registration failed:', error);
        setServerError(
          error instanceof Error ? error.message : 'Unknown error',
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  }

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
            title="Create an account"
            description="Join Epick'em and start making predictions."
          />

          {created ? (
            <View className="gap-4">
              <Text accessibilityRole="alert" className="text-foreground">
                Your account has been created successfully.
              </Text>
              <Text className="text-muted-foreground">
                Sign in will be available when authentication is enabled.
              </Text>
              <Link href="/login" asChild>
                <Button>
                  <Text>Go to login</Text>
                </Button>
              </Link>
            </View>
          ) : (
            <View className="gap-4">
              <View className="gap-2">
                <Text nativeID="register-username-label">Username</Text>
                <Input
                  accessibilityLabel="Username"
                  accessibilityLabelledBy="register-username-label"
                  accessibilityHint="3 to 32 letters, numbers, underscores, dots or hyphens"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="username-new"
                  value={form.username}
                  onChangeText={(value) => updateField('username', value)}
                  editable={!isSubmitting}
                />
                {errors.username && (
                  <Text accessibilityRole="alert" className="text-destructive">
                    {errors.username}
                  </Text>
                )}
              </View>

              <View className="gap-2">
                <Text nativeID="register-password-label">Password</Text>
                <Input
                  accessibilityLabel="Password"
                  accessibilityLabelledBy="register-password-label"
                  secureTextEntry
                  autoCapitalize="none"
                  autoComplete="new-password"
                  value={form.password}
                  onChangeText={(value) => updateField('password', value)}
                  editable={!isSubmitting}
                />
                {errors.password && (
                  <Text accessibilityRole="alert" className="text-destructive">
                    {errors.password}
                  </Text>
                )}
              </View>

              <View className="gap-2">
                <Text nativeID="register-confirm-label">Confirm password</Text>
                <Input
                  accessibilityLabel="Confirm password"
                  accessibilityLabelledBy="register-confirm-label"
                  secureTextEntry
                  autoCapitalize="none"
                  autoComplete="new-password"
                  value={form.confirmPassword}
                  onChangeText={(value) =>
                    updateField('confirmPassword', value)
                  }
                  editable={!isSubmitting}
                />
                {errors.confirmPassword && (
                  <Text accessibilityRole="alert" className="text-destructive">
                    {errors.confirmPassword}
                  </Text>
                )}
              </View>

              {serverError ? (
                <Text accessibilityRole="alert" className="text-destructive">
                  {serverError}
                </Text>
              ) : null}

              <Button
                onPress={handleSubmit}
                disabled={isSubmitting}
                accessibilityLabel="Create account"
              >
                {isSubmitting ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text>Create account</Text>
                )}
              </Button>
            </View>
          )}

          <View className="flex-row flex-wrap justify-center gap-1">
            <Text className="text-muted-foreground">
              Already have an account?
            </Text>
            <Link href="/login">
              <Text className="font-semibold text-primary">Sign in</Text>
            </Link>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
