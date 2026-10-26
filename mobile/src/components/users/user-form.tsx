import { useTranslation } from '@/i18n';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { PasswordInput } from '@/components/ui/password-input';
import { FormMessage } from '@/components/ui/feedback';
import { Icon } from '@/components/ui/icon';
import Tick02Icon from '@hugeicons/core-free-icons/Tick02Icon';
import ShieldUserIcon from '@hugeicons/core-free-icons/ShieldUserIcon';
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
        <Text className="text-sm font-medium" nativeID="user-form-username">
          {t('common.username')}
        </Text>
        <Input
          accessibilityLabel={t('common.username')}
          accessibilityLabelledBy="user-form-username"
          invalid={Boolean(errors.username)}
          accessibilityHint={t('common.usernameHint')}
          autoCapitalize="none"
          autoCorrect={false}
          value={form.username}
          editable={!saving}
          onChangeText={(value) => updateField('username', value)}
        />
        {errors.username ? (
          <FormMessage>{t(errors.username)}</FormMessage>
        ) : null}
      </View>

      <View className="gap-2 border-t border-border pt-4">
        <Text className="text-sm font-medium" nativeID="user-form-password">
          {t('common.newPassword')}
        </Text>
        <Text variant="muted">{t('form.passwordHint')}</Text>
        <PasswordInput
          accessibilityLabel={t('common.newPassword')}
          accessibilityLabelledBy="user-form-password"
          invalid={Boolean(errors.password)}
          autoComplete="new-password"
          value={form.password}
          editable={!saving}
          onChangeText={(value) => updateField('password', value)}
        />
        {errors.password ? (
          <FormMessage>{t(errors.password)}</FormMessage>
        ) : null}
      </View>

      <View className="gap-2">
        <Text className="text-sm font-medium" nativeID="user-form-confirm">
          {t('common.confirmNewPassword')}
        </Text>
        <PasswordInput
          accessibilityLabel={t('common.confirmNewPassword')}
          accessibilityLabelledBy="user-form-confirm"
          invalid={Boolean(errors.confirmPassword)}
          autoComplete="new-password"
          value={form.confirmPassword}
          editable={!saving}
          onChangeText={(value) => updateField('confirmPassword', value)}
        />
        {errors.confirmPassword ? (
          <FormMessage>{t(errors.confirmPassword)}</FormMessage>
        ) : null}
      </View>

      {allowRoleEdit ? (
        <View className="gap-2">
          <Text>{t('common.role')}</Text>
          <View
            className="gap-2"
            accessibilityRole="radiogroup"
            accessibilityLabel={t('common.role')}
          >
            {(['admin', 'user', 'watcher'] as const).map((role) => (
              <Button
                key={role}
                variant="outline"
                className={`justify-start gap-3 ${form.role === role ? 'border-primary bg-muted' : ''}`}
                role="radio"
                accessibilityRole="radio"
                disabled={saving}
                accessibilityLabel={t('account.role', { role })}
                accessibilityState={{
                  selected: form.role === role,
                  checked: form.role === role,
                }}
                onPress={() => updateField('role', role)}
              >
                <Icon
                  icon={ShieldUserIcon}
                  tone={form.role === role ? 'primary' : 'muted-foreground'}
                />
                <Text className="flex-1 text-left">{role}</Text>
                {form.role === role ? (
                  <Icon icon={Tick02Icon} tone="foreground" />
                ) : null}
              </Button>
            ))}
          </View>
        </View>
      ) : null}

      {error ? <FormMessage>{t(error)}</FormMessage> : null}

      {success ? <FormMessage success>{t(success)}</FormMessage> : null}

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
