import { useTranslation } from '@/i18n';
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
  const { t } = useTranslation();
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

  const [originalUser, setOriginalUser] = useState(user);
  if (
    originalUser.id !== user.id ||
    originalUser.username !== user.username ||
    originalUser.role !== user.role
  ) {
    setOriginalUser(user);
    setForm((previous) => ({
      ...previous,
      username: user.username,
      role: user.role,
    }));
  }

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
      setError('form.noChanges');
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
      setSuccess('form.saved');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'form.failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View className="gap-5">
      <View className="gap-2">
        <Text nativeID="user-form-username">{t('common.username')}</Text>
        <Input
          accessibilityLabel={t('common.username')}
          accessibilityLabelledBy="user-form-username"
          accessibilityHint={t('common.usernameHint')}
          autoCapitalize="none"
          autoCorrect={false}
          value={form.username}
          editable={!saving}
          onChangeText={(value) => updateField('username', value)}
        />
        {errors.username ? (
          <Text accessibilityRole="alert" className="text-destructive">
            {t(errors.username)}
          </Text>
        ) : null}
      </View>

      <View className="gap-2">
        <Text nativeID="user-form-password">{t('common.newPassword')}</Text>
        <Input
          accessibilityLabel={t('common.newPassword')}
          accessibilityLabelledBy="user-form-password"
          secureTextEntry
          autoComplete="new-password"
          value={form.password}
          editable={!saving}
          onChangeText={(value) => updateField('password', value)}
        />
        {errors.password ? (
          <Text accessibilityRole="alert" className="text-destructive">
            {t(errors.password)}
          </Text>
        ) : null}
      </View>

      <View className="gap-2">
        <Text nativeID="user-form-confirm">
          {t('common.confirmNewPassword')}
        </Text>
        <Input
          accessibilityLabel={t('common.confirmNewPassword')}
          accessibilityLabelledBy="user-form-confirm"
          secureTextEntry
          autoComplete="new-password"
          value={form.confirmPassword}
          editable={!saving}
          onChangeText={(value) => updateField('confirmPassword', value)}
        />
        {errors.confirmPassword ? (
          <Text accessibilityRole="alert" className="text-destructive">
            {t(errors.confirmPassword)}
          </Text>
        ) : null}
      </View>

      {allowRoleEdit ? (
        <View className="gap-2">
          <Text>{t('common.role')}</Text>
          <View className="flex-row flex-wrap gap-2">
            {(['admin', 'user', 'watcher'] as const).map((role) => (
              <Button
                key={role}
                variant={form.role === role ? 'default' : 'outline'}
                disabled={saving}
                accessibilityLabel={t('account.role', { role })}
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
          {t(error)}
        </Text>
      ) : null}

      {success ? <Text accessibilityRole="alert">{t(success)}</Text> : null}

      <Button
        disabled={saving}
        onPress={() => void submit()}
        accessibilityLabel={t('common.save')}
      >
        {saving ? (
          <ActivityIndicator accessibilityLabel={t('common.loading')} />
        ) : (
          <Text>{t('common.save')}</Text>
        )}
      </Button>
    </View>
  );
}
