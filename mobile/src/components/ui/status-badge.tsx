import { View } from 'react-native';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';

const STATUS_TONES: Record<string, { container: string; text: string }> = {
  draft: {
    container:
      'border-zinc-200 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800',
    text: 'text-zinc-700 dark:text-zinc-200',
  },
  registration: {
    container:
      'border-violet-200 bg-violet-100 dark:border-violet-800 dark:bg-violet-950',
    text: 'text-violet-700 dark:text-violet-300',
  },
  registered: {
    container:
      'border-violet-200 bg-violet-100 dark:border-violet-800 dark:bg-violet-950',
    text: 'text-violet-700 dark:text-violet-300',
  },
  ongoing: {
    container: 'border-sky-200 bg-sky-100 dark:border-sky-800 dark:bg-sky-950',
    text: 'text-sky-700 dark:text-sky-300',
  },
  in: {
    container: 'border-sky-200 bg-sky-100 dark:border-sky-800 dark:bg-sky-950',
    text: 'text-sky-700 dark:text-sky-300',
  },
  pending: {
    container:
      'border-amber-200 bg-amber-100 dark:border-amber-800 dark:bg-amber-950',
    text: 'text-amber-700 dark:text-amber-300',
  },
  finished: {
    container:
      'border-emerald-200 bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950',
    text: 'text-emerald-700 dark:text-emerald-300',
  },
  checked_in: {
    container:
      'border-emerald-200 bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950',
    text: 'text-emerald-700 dark:text-emerald-300',
  },
  qualified: {
    container:
      'border-emerald-200 bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950',
    text: 'text-emerald-700 dark:text-emerald-300',
  },
  cancelled: {
    container: 'border-red-200 bg-red-100 dark:border-red-900 dark:bg-red-950',
    text: 'text-red-700 dark:text-red-300',
  },
  disqualified: {
    container: 'border-red-200 bg-red-100 dark:border-red-900 dark:bg-red-950',
    text: 'text-red-700 dark:text-red-300',
  },
  eliminated: {
    container: 'border-red-200 bg-red-100 dark:border-red-900 dark:bg-red-950',
    text: 'text-red-700 dark:text-red-300',
  },
  withdrawn: {
    container:
      'border-zinc-200 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800',
    text: 'text-zinc-600 dark:text-zinc-300',
  },
};

export function StatusBadge({
  status,
  label,
  className,
}: {
  status: string;
  label: string;
  className?: string;
}) {
  const tone = STATUS_TONES[status] ?? STATUS_TONES.draft;
  return (
    <View
      className={cn(
        'self-start rounded-full border px-2.5 py-1',
        tone.container,
        className,
      )}
    >
      <Text className={cn('text-xs font-semibold', tone.text)}>{label}</Text>
    </View>
  );
}
