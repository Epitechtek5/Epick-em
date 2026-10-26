import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';

import type { User } from '@/features/auth/types';
import type { UpdateUserRequest } from '@/features/users/api';
import {
  validateUserForm,
  type UserFormErrors,
  type UserFormValues,
} from '@/features/users/validation';

interface UserFormProps {
  user: User;
  allowRoleEdit?: boolean;
  onSave: (changes: UpdateUserRequest) => Promise<void>;
}

export function UserForm({
  user,
  allowRoleEdit = false,
  onSave,
}: UserFormProps) {
  const [form, setForm] = useState<UserFormValues>({
    username: user.username,
    password: '',
    confirmPassword: '',
    role: user.role,
  });

  const [errors, setErrors] = useState<UserFormErrors>({});
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);

  function updateField<K extends keyof UserFormValues>(
    field: K,
    value: UserFormValues[K],
  ) {
    setForm((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => ({ ...previous, [field]: undefined }));
    setError('');
    setSuccess('');
  }

  async function submit() {
    if (saving) return;

    const validation = validateUserForm(form, user.username);
    setErrors(validation);

    if (Object.keys(validation).length > 0) return;

    const changes: UpdateUserRequest = {};

    if (form.username !== user.username) {
      changes.username = form.username;
    }

    if (form.password) {
      changes.password = form.password;
    }

    if (allowRoleEdit && form.role !== user.role) {
      changes.role = form.role;
    }

    if (Object.keys(changes).length === 0) {
      setError('No changes to save.');
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      await onSave(changes);
      setForm((previous) => ({
        ...previous,
        password: '',
        confirmPassword: '',
      }));
      setSuccess('Changes saved successfully.');
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Unable to save changes.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <View className="gap-5">
      <View className="gap-2">
        <Text nativeID="user-form-username">Username</Text>
        <Input
          accessibilityLabel="Username"
          accessibilityLabelledBy="user-form-username"
          accessibilityHint="3 to 32 letters, numbers, underscores, dots or hyphens"
          autoCapitalize="none"
          autoCorrect={false}
          value={form.username}
          editable={!saving}
          onChangeText={(value) => updateField('username', value)}
        />
        {errors.username ? (
          <Text accessibilityRole="alert" className="text-destructive">
            {errors.username}
          </Text>
        ) : null}
      </View>

      <View className="gap-2">
        <Text nativeID="user-form-password">New password</Text>
        <Input
          accessibilityLabel="New password"
          accessibilityLabelledBy="user-form-password"
          secureTextEntry
          autoComplete="new-password"
          value={form.password}
          editable={!saving}
          onChangeText={(value) => updateField('password', value)}
        />
        {errors.password ? (
          <Text accessibilityRole="alert" className="text-destructive">
            {errors.password}
          </Text>
        ) : null}
      </View>

      <View className="gap-2">
        <Text nativeID="user-form-confirm">Confirm new password</Text>
        <Input
          accessibilityLabel="Confirm new password"
          accessibilityLabelledBy="user-form-confirm"
          secureTextEntry
          autoComplete="new-password"
          value={form.confirmPassword}
          editable={!saving}
          onChangeText={(value) => updateField('confirmPassword', value)}
        />
        {errors.confirmPassword ? (
          <Text accessibilityRole="alert" className="text-destructive">
            {errors.confirmPassword}
          </Text>
        ) : null}
      </View>

      {allowRoleEdit ? (
        <View className="gap-2">
          <Text>Role</Text>
          <View className="flex-row flex-wrap gap-2">
            {(['admin', 'user', 'watcher'] as const).map((role) => (
              <Button
                key={role}
                variant={form.role === role ? 'default' : 'outline'}
                disabled={saving}
                accessibilityLabel={`Role: ${role}`}
                accessibilityState={{ selected: form.role === role }}
                onPress={() => updateField('role', role)}
              >
                <Text>{role}</Text>
              </Button>
            ))}
          </View>
        </View>
      ) : null}

      {error ? (
        <Text accessibilityRole="alert" className="text-destructive">
          {error}
        </Text>
      ) : null}

      {success ? <Text accessibilityRole="alert">{success}</Text> : null}

      <Button
        disabled={saving}
        onPress={() => void submit()}
        accessibilityLabel="Save changes"
      >
        {saving ? <ActivityIndicator /> : <Text>Save changes</Text>}
      </Button>
    </View>
  );
}
