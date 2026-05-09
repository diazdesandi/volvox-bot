import type {
  AiAutoModAction,
  AiAutoModCategory,
  AiAutoModDmNotificationAction,
} from '@/types/config';

export type SelectableAiAutoModAction = Exclude<AiAutoModAction, 'none'>;

export const AI_AUTOMOD_CATEGORIES = [
  { key: 'toxicity', label: 'Toxicity', defaultThreshold: 0.7, defaultActions: ['flag'] },
  { key: 'spam', label: 'Spam', defaultThreshold: 0.8, defaultActions: ['delete'] },
  { key: 'harassment', label: 'Harassment', defaultThreshold: 0.7, defaultActions: ['warn'] },
  { key: 'hateSpeech', label: 'Hate Speech', defaultThreshold: 0.8, defaultActions: ['timeout'] },
  {
    key: 'sexualContent',
    label: 'Sexual Content',
    defaultThreshold: 0.8,
    defaultActions: ['delete'],
  },
  { key: 'violence', label: 'Violence', defaultThreshold: 0.85, defaultActions: ['ban'] },
  { key: 'selfHarm', label: 'Self-Harm', defaultThreshold: 0.7, defaultActions: ['flag'] },
] as const satisfies readonly {
  key: AiAutoModCategory;
  label: string;
  defaultThreshold: number;
  defaultActions: readonly SelectableAiAutoModAction[];
}[];

export const AI_AUTOMOD_ACTION_OPTIONS = [
  { value: 'flag', label: 'Flag & Log' },
  { value: 'delete', label: 'Hard Delete' },
  { value: 'warn', label: 'Issue Warning' },
  { value: 'timeout', label: 'Temporary Timeout' },
  { value: 'kick', label: 'Server Kick' },
  { value: 'ban', label: 'Permanent Ban' },
] as const satisfies readonly { value: SelectableAiAutoModAction; label: string }[];

export const AI_AUTOMOD_DM_NOTIFICATION_OPTIONS = [
  { value: 'warn', label: 'Warnings', description: 'DM when AI AutoMod issues a warning.' },
  { value: 'timeout', label: 'Timeouts', description: 'DM when AI AutoMod applies a timeout.' },
  { value: 'kick', label: 'Kicks', description: 'DM when AI AutoMod removes a member.' },
  { value: 'ban', label: 'Bans', description: 'DM when AI AutoMod bans a member.' },
] as const satisfies readonly {
  value: AiAutoModDmNotificationAction;
  label: string;
  description: string;
}[];
