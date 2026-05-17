'use client';

import {
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Copy,
  Hash,
  Search,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { MouseEvent } from 'react';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { EmptyState } from '@/components/dashboard/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useGuildSelection } from '@/hooks/use-guild-selection';
import type { AuditEntry } from '@/stores/audit-log-store';
import { useAuditLogStore } from '@/stores/audit-log-store';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Selects a UI variant name based on keywords present in an audit action string.
 *
 * @param action - The audit action identifier to inspect; substring matches are case-sensitive.
 * @returns Badge variant for destructive moderation actions, creates, updates, AI/triage events, or generic entries.
 */
function actionVariant(action: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (action.includes('delete')) return 'destructive';
  if (action.includes('ban') || action.includes('kick') || action.includes('timeout')) {
    return 'destructive';
  }
  if (action.includes('create')) return 'default';
  if (action.includes('update')) return 'secondary';
  if (action.includes('triage') || action.includes('ai_automod')) return 'secondary';
  return 'outline';
}

const ACTION_CATEGORY_OPTIONS = [
  { value: 'all', label: 'All categories' },
  { value: 'moderation', label: 'Moderation' },
  { value: 'ai', label: 'AI and triage' },
  { value: 'config', label: 'Config' },
  { value: 'members', label: 'Members' },
  { value: 'tickets', label: 'Tickets' },
  { value: 'temp_roles', label: 'Temp roles' },
  { value: 'notifications', label: 'Notifications' },
] as const;

const ACTION_GROUPS = [
  {
    label: 'Moderation',
    category: 'moderation',
    options: [
      { value: 'mod.warn', label: 'Moderation: Warn' },
      { value: 'mod.timeout', label: 'Moderation: Timeout' },
      { value: 'mod.untimeout', label: 'Moderation: Remove timeout' },
      { value: 'mod.kick', label: 'Moderation: Kick' },
      { value: 'mod.ban', label: 'Moderation: Ban' },
      { value: 'mod.unban', label: 'Moderation: Unban' },
      { value: 'mod.tempban', label: 'Moderation: Temp ban' },
      { value: 'mod.softban', label: 'Moderation: Soft ban' },
      { value: 'moderation.create', label: 'Moderation: API create' },
      { value: 'moderation.delete', label: 'Moderation: API delete' },
    ],
  },
  {
    label: 'AI and triage',
    category: 'ai',
    options: [
      { value: 'ai_automod.flag', label: 'AI auto-mod: Flag' },
      { value: 'ai_automod.warn', label: 'AI auto-mod: Warn' },
      { value: 'ai_automod.delete', label: 'AI auto-mod: Delete' },
      { value: 'ai_automod.timeout', label: 'AI auto-mod: Timeout' },
      { value: 'ai_automod.kick', label: 'AI auto-mod: Kick' },
      { value: 'ai_automod.ban', label: 'AI auto-mod: Ban' },
      { value: 'ai_automod.none', label: 'AI auto-mod: No action' },
      { value: 'triage.moderation_flag', label: 'Triage: Moderation flag' },
      { value: 'triage.budget_exceeded', label: 'Triage: Budget exceeded' },
    ],
  },
  {
    label: 'Config and dashboard',
    category: 'config',
    options: [
      { value: 'config.update', label: 'Config: Update' },
      { value: 'guild.update', label: 'Guild: Update' },
    ],
  },
  {
    label: 'Members',
    category: 'members',
    options: [
      { value: 'members.update', label: 'Members: Update' },
      { value: 'members.xp_update', label: 'Members: XP update' },
    ],
  },
  {
    label: 'Tickets',
    category: 'tickets',
    options: [
      { value: 'tickets.create', label: 'Tickets: Create' },
      { value: 'tickets.update', label: 'Tickets: Update' },
      { value: 'tickets.delete', label: 'Tickets: Delete' },
    ],
  },
  {
    label: 'Temp roles',
    category: 'temp_roles',
    options: [
      { value: 'temp-roles.create', label: 'Temp roles: Assign' },
      { value: 'temp-roles.delete', label: 'Temp roles: Revoke' },
      { value: 'temp_roles.create', label: 'Temp roles: Assign (underscore)' },
      { value: 'temp_roles.delete', label: 'Temp roles: Revoke (underscore)' },
      { value: 'tempRoles.create', label: 'Temp roles: Legacy assign' },
      { value: 'tempRoles.delete', label: 'Temp roles: Legacy revoke' },
      { value: 'temprole.create', label: 'Temp roles: Legacy create' },
      { value: 'temprole.delete', label: 'Temp roles: Legacy delete' },
    ],
  },
  {
    label: 'Notifications',
    category: 'notifications',
    options: [
      { value: 'notifications.webhooks_create', label: 'Notifications: Add webhook' },
      { value: 'notifications.webhooks_delete', label: 'Notifications: Delete webhook' },
      { value: 'notifications.test_create', label: 'Notifications: Test webhook' },
    ],
  },
] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function getDetailString(details: Record<string, unknown> | null, key: string): string | null {
  const value = details?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function getDetailNumber(details: Record<string, unknown> | null, key: string): number | null {
  const value = details?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getDetailStringArray(details: Record<string, unknown> | null, key: string): string[] {
  const value = details?.[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function humanizeKey(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
}

function formatPercent(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const normalized = value <= 1 ? value * 100 : value;
  return `${Math.round(normalized)}%`;
}

const SYSTEM_ACTOR_LABELS: Record<string, string> = {
  'api-secret': 'Internal API',
  unknown: 'Unknown actor',
  'volvox-bot': 'Volvox.Bot',
};

function getActorLabel(entry: AuditEntry): string {
  const taggedUser = entry.user_tag?.trim();
  if (taggedUser) return taggedUser;

  const systemActorLabel = SYSTEM_ACTOR_LABELS[entry.user_id];
  if (systemActorLabel) return systemActorLabel;

  const fallbackIdSuffix = entry.user_id.trim().slice(-4);
  return fallbackIdSuffix ? `User ${fallbackIdSuffix}` : 'Unknown actor';
}

function getTargetLabel(entry: AuditEntry): string | null {
  if (!entry.target_id) return null;
  return entry.target_tag || `Target ${entry.target_id.slice(-4)}`;
}

function getModerationVerb(action: string): string {
  const verb = action.replace(/^mod\./, '').replace(/^ai_automod\./, '');
  const verbs: Record<string, string> = {
    ban: 'banned',
    delete: 'deleted',
    flag: 'flagged',
    kick: 'kicked',
    none: 'took no action on',
    softban: 'soft-banned',
    tempban: 'temporarily banned',
    timeout: 'timed out',
    unban: 'unbanned',
    untimeout: 'removed timeout from',
    warn: 'warned',
  };
  return verbs[verb] ?? humanizeKey(verb);
}

function getConfigChangedKeys(details: Record<string, unknown> | null): string[] {
  const diff = asRecord(details?.configDiff);
  const before = asRecord(diff?.before);
  const after = asRecord(diff?.after);
  return Array.from(new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]));
}

function getAuditSummary(entry: AuditEntry): string {
  const details = entry.details;
  const actor = getActorLabel(entry);
  const target = getTargetLabel(entry);

  if (entry.action.startsWith('mod.')) {
    return `${actor} ${getModerationVerb(entry.action)} ${target ?? 'a member'}`;
  }

  if (entry.action.startsWith('ai_automod.')) {
    return `AI auto-mod ${getModerationVerb(entry.action)} ${target ?? 'a message'}`;
  }

  if (entry.action === 'triage.moderation_flag') {
    const targetMessageCount = getDetailStringArray(details, 'targetMessageIds').length;
    const recommendedAction = getDetailString(details, 'recommendedAction') ?? 'review';
    const countLabel =
      targetMessageCount > 0
        ? `${targetMessageCount} message${targetMessageCount === 1 ? '' : 's'}`
        : 'message';
    return `Triage flagged ${countLabel} for ${recommendedAction}`;
  }

  if (entry.action === 'triage.budget_exceeded') {
    const pct = getDetailNumber(details, 'pct');
    const percent = formatPercent(pct);
    return `Triage budget exceeded${percent ? ` at ${percent}` : ''}`;
  }

  if (entry.action === 'config.update') {
    const changedKeys = getConfigChangedKeys(details);
    return `${actor} updated config${changedKeys.length ? `: ${changedKeys.join(', ')}` : ''}`;
  }

  const readableAction = humanizeKey(entry.action.replace(/\./g, ' '));
  return `${actor} ${readableAction}${target ? ` ${target}` : ''}`;
}

function DetailItem({
  label,
  value,
  className = '',
}: {
  label: string;
  value: string | number | boolean | null;
  className?: string;
}) {
  if (value === null || value === '') return null;

  return (
    <div
      className={`min-w-0 overflow-hidden rounded-[12px] border border-border/30 bg-background/40 px-3 py-2 ${className}`}
    >
      <p className="text-[9px] font-black uppercase tracking-[0.22em] text-muted-foreground/50">
        {label}
      </p>
      <p className="mt-1 whitespace-normal break-words text-xs font-semibold leading-relaxed text-foreground/80 [overflow-wrap:anywhere]">
        {String(value)}
      </p>
    </div>
  );
}

function ModerationDetails({ entry }: { entry: AuditEntry }) {
  const details = entry.details;
  if (!entry.action.startsWith('mod.')) return null;

  const caseNumber = getDetailNumber(details, 'caseNumber');
  const reason = getDetailString(details, 'reason');

  return (
    <div className="grid min-w-0 gap-3 md:grid-cols-3">
      {caseNumber != null && (
        <div className="min-w-0 overflow-hidden rounded-[12px] border border-border/30 bg-background/40 px-3 py-2">
          <p className="text-[9px] font-black uppercase tracking-[0.22em] text-muted-foreground/50">
            Case
          </p>
          <p className="mt-1 text-xs font-semibold text-foreground/80">Case #{caseNumber}</p>
        </div>
      )}
      <DetailItem label="Action" value={getModerationVerb(entry.action)} />
      <DetailItem label="Reason" value={reason} />
    </div>
  );
}

function AiAutoModDetails({ entry }: { entry: AuditEntry }) {
  const details = entry.details;
  if (!entry.action.startsWith('ai_automod.')) return null;

  const scores = asRecord(details?.scores);
  const thresholds = asRecord(details?.thresholds);
  const categories = getDetailStringArray(details, 'categories');
  const skippedActions = getDetailStringArray(details, 'skippedActions');

  return (
    <div className="space-y-3">
      <div className="grid min-w-0 gap-3 md:grid-cols-3">
        <DetailItem label="Model" value={getDetailString(details, 'model')} />
        <DetailItem label="Channel" value={getDetailString(details, 'channelId')} />
        <DetailItem
          label="Case"
          value={
            getDetailNumber(details, 'caseNumber') != null
              ? `Case #${getDetailNumber(details, 'caseNumber')}`
              : null
          }
        />
        <DetailItem
          label="Reason"
          value={getDetailString(details, 'reason')}
          className="md:col-span-3"
        />
        <DetailItem
          label="Message"
          value={getDetailString(details, 'messageUrl')}
          className="md:col-span-3"
        />
        <DetailItem
          label="Skipped"
          value={skippedActions.join(', ') || null}
          className="md:col-span-3"
        />
      </div>

      {categories.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {categories.map((category) => (
            <Badge key={category} variant="outline" className="text-[10px] uppercase">
              {humanizeKey(category)}
            </Badge>
          ))}
        </div>
      )}

      {scores && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(scores).map(([key, value]) => {
            const percent = formatPercent(value);
            if (!percent) return null;
            return (
              <span
                key={key}
                className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[10px] font-bold text-primary"
              >
                {humanizeKey(key)} {percent}
              </span>
            );
          })}
        </div>
      )}

      {thresholds && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(thresholds).map(([key, value]) => {
            const percent = formatPercent(value);
            if (!percent) return null;
            return (
              <span
                key={key}
                className="rounded-full border border-border/40 bg-background/40 px-3 py-1 text-[10px] font-bold text-muted-foreground"
              >
                {humanizeKey(key)} threshold {percent}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RawDetailsDisclosure({
  entry,
  expanded,
  onToggle,
}: {
  entry: AuditEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const rawDetailsId = `audit-raw-details-${entry.id}`;

  return (
    <div className="w-full overflow-hidden rounded-[14px] border border-border/30 bg-background/50">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 border-b border-border/20 px-3 py-2 text-left transition-colors hover:bg-muted/30"
        aria-controls={rawDetailsId}
        aria-expanded={expanded}
        aria-label={expanded ? 'Hide raw details' : 'Show raw details'}
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
      >
        <span className="text-[9px] font-black uppercase tracking-[0.22em] text-muted-foreground/50">
          Raw details
        </span>
        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground/60">
          {expanded ? 'Hide' : 'Show'}
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </span>
      </button>
      {expanded && (
        <pre
          id={rawDetailsId}
          className="max-h-64 w-full overflow-x-auto p-3 text-xs text-foreground/70 scrollbar-thin scrollbar-thumb-border/20"
        >
          {JSON.stringify(entry.details, null, 2)}
        </pre>
      )}
    </div>
  );
}

/**
 * Copies the provided string to the clipboard and shows a transient visual confirmation while preventing the click from bubbling.
 *
 * @param value - The string to copy to the user's clipboard
 */
function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimeoutRef.current) {
        clearTimeout(resetTimeoutRef.current);
      }
    };
  }, []);

  const handleCopy = async (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();

    if (!navigator.clipboard?.writeText) {
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);

      if (resetTimeoutRef.current) {
        clearTimeout(resetTimeoutRef.current);
      }

      resetTimeoutRef.current = setTimeout(() => {
        setCopied(false);
        resetTimeoutRef.current = null;
      }, 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Button
      variant="secondary"
      size="icon-sm"
      onClick={handleCopy}
      className="ml-2 text-muted-foreground/30 hover:text-foreground active:scale-90"
      aria-label="Copy ID"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  );
}

const PAGE_SIZE = 25;

/**
 * Renders a non-interactive skeleton table that mirrors the audit log's columns and responsive layout.
 *
 * @returns A JSX element containing placeholder rows and cells matching the audit log table structure for loading states.
 */
function AuditLogSkeleton() {
  return (
    <div className="overflow-x-auto rounded-[24px] border border-border/40 bg-card/40 backdrop-blur-2xl shadow-lg">
      <Table>
        <TableHeader>
          <TableRow className="border-border/20">
            <TableHead className="w-10 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50" />
            <TableHead className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">
              Event
            </TableHead>
            <TableHead className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">
              User
            </TableHead>
            <TableHead className="hidden md:table-cell text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">
              Target
            </TableHead>
            <TableHead className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">
              Date
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 8 }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: skeleton
            <TableRow key={`skeleton-${i}`} className="border-border/10">
              <TableCell className="w-10 px-2">
                <Skeleton className="h-4 w-4" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-5 w-24" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-28" />
              </TableCell>
              <TableCell className="hidden md:table-cell">
                <Skeleton className="h-4 w-32" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-20" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * Render the audit log page for the currently selected guild, showing stats, filter controls,
 * a paginated table of audit entries with expandable details, and error/empty states.
 *
 * The component manages local UI state (expanded rows, debounced user search) and drives the
 * audit log store for filtering and fetching. If a fetch result indicates `"unauthorized"`,
 * the router is redirected to `/login`.
 *
 * @returns A React element that renders the audit log UI.
 */
export default function AuditLogPage() {
  const router = useRouter();
  const { entries, total, loading, error, filters, setFilters, fetch } = useAuditLogStore();
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [expandedRawDetailsRows, setExpandedRawDetailsRows] = useState<Set<number>>(new Set());

  const [userSearch, setUserSearch] = useState(filters.userId);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [debouncedUserSearch, setDebouncedUserSearch] = useState(filters.userId);

  const onGuildChange = useCallback(() => {
    useAuditLogStore.getState().reset();
    setExpandedRows(new Set());
    setExpandedRawDetailsRows(new Set());
    setUserSearch('');
    setDebouncedUserSearch('');
  }, []);
  const guildId = useGuildSelection({ onGuildChange });

  useEffect(() => {
    clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedUserSearch(userSearch);
      setFilters({ userId: userSearch, offset: 0 });
    }, 300);
    return () => clearTimeout(searchTimerRef.current);
  }, [userSearch, setFilters]);

  useEffect(() => {
    if (!guildId) return;
    void fetch(guildId, {
      action: filters.action,
      category: filters.category,
      userId: debouncedUserSearch,
      targetId: filters.targetId,
      channelId: filters.channelId,
      startDate: filters.startDate,
      endDate: filters.endDate,
      offset: filters.offset,
    }).then((res) => {
      if (res === 'unauthorized') router.replace('/login');
    });
    return () => {
      useAuditLogStore.getState().abortInFlight();
    };
  }, [
    guildId,
    debouncedUserSearch,
    filters.action,
    filters.category,
    filters.targetId,
    filters.channelId,
    filters.startDate,
    filters.endDate,
    filters.offset,
    fetch,
    router,
  ]);

  const toggleRow = useCallback((id: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        setExpandedRawDetailsRows((rawRows) => {
          if (!rawRows.has(id)) return rawRows;
          const nextRawRows = new Set(rawRows);
          nextRawRows.delete(id);
          return nextRawRows;
        });
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleRawDetails = useCallback((id: number) => {
    setExpandedRawDetailsRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const currentPage = Math.floor(filters.offset / PAGE_SIZE) + 1;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const visibleActionGroups = filters.category
    ? ACTION_GROUPS.filter((group) => group.category === filters.category)
    : ACTION_GROUPS;

  return (
    <ErrorBoundary title="Audit log failed to load">
      <div className="space-y-6">
        {/* Stats */}
        {guildId && (
          <div className="grid gap-4 md:grid-cols-3">
            <div className="group relative overflow-hidden rounded-[24px] border border-border/40 bg-card/40 p-6 backdrop-blur-2xl shadow-lg bg-gradient-to-br from-primary/12 to-transparent">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Total Entries
              </p>
              <p className="mt-3 text-3xl font-bold tabular-nums md:text-4xl">
                {total.toLocaleString()}
              </p>
            </div>
            <div className="group relative overflow-hidden rounded-[24px] border border-border/40 bg-card/40 p-6 backdrop-blur-2xl shadow-lg bg-gradient-to-br from-secondary/10 to-transparent">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Active Filters
              </p>
              <p className="mt-3 text-3xl font-bold tabular-nums md:text-4xl">
                {
                  [
                    filters.action,
                    filters.category,
                    debouncedUserSearch,
                    filters.targetId,
                    filters.channelId,
                    filters.startDate,
                    filters.endDate,
                  ].filter(Boolean).length
                }
              </p>
            </div>
            <div className="group relative overflow-hidden rounded-[24px] border border-border/40 bg-card/40 p-6 backdrop-blur-2xl shadow-lg">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Expanded Rows
              </p>
              <p className="mt-3 text-3xl font-bold tabular-nums md:text-4xl">
                {expandedRows.size}
              </p>
            </div>
          </div>
        )}

        {/* No guild */}
        {!guildId && (
          <EmptyState
            icon={ClipboardList}
            title="Select a server"
            description="Choose a server from the sidebar to view the audit log."
          />
        )}

        {/* Content */}
        {guildId && (
          <>
            {/* Compact filter strip */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative min-w-[220px] flex-1 max-w-xs">
                <Input
                  className="pl-10 pr-10"
                  placeholder="User ID"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  aria-label="Filter audit log by user ID"
                />
                <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50 pointer-events-none z-10" />
                {userSearch && (
                  <button
                    type="button"
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-foreground transition-colors z-10"
                    onClick={() => {
                      setUserSearch('');
                      setDebouncedUserSearch('');
                      setFilters({ userId: '', offset: 0 });
                    }}
                    aria-label="Clear search"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              <div className="relative min-w-[200px] flex-1 max-w-xs">
                <Input
                  className="pl-10"
                  placeholder="Target ID"
                  value={filters.targetId}
                  onChange={(e) => setFilters({ targetId: e.target.value, offset: 0 })}
                  aria-label="Filter audit log by target ID"
                />
                <Hash className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50 pointer-events-none z-10" />
              </div>

              <div className="relative min-w-[200px] flex-1 max-w-xs">
                <Input
                  className="pl-10"
                  placeholder="Channel ID"
                  value={filters.channelId}
                  onChange={(e) => setFilters({ channelId: e.target.value, offset: 0 })}
                  aria-label="Filter audit log by channel ID"
                />
                <Hash className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50 pointer-events-none z-10" />
              </div>

              <Select
                value={filters.category || 'all'}
                onValueChange={(val) =>
                  setFilters({
                    category: val === 'all' ? '' : val,
                    action: '',
                    offset: 0,
                  })
                }
              >
                <SelectTrigger
                  aria-label="Audit category filter"
                  className="w-[190px] text-[10px] font-black uppercase tracking-[0.2em] data-[placeholder]:text-muted-foreground/40"
                >
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  {ACTION_CATEGORY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={filters.action || 'all'}
                onValueChange={(val) => setFilters({ action: val === 'all' ? '' : val, offset: 0 })}
              >
                <SelectTrigger
                  aria-label="Audit action filter"
                  className="w-[240px] text-[10px] font-black uppercase tracking-[0.2em] data-[placeholder]:text-muted-foreground/40"
                >
                  <SelectValue placeholder="All actions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All actions</SelectItem>
                  {visibleActionGroups.map((group, index) => (
                    <Fragment key={group.label}>
                      {index > 0 && <SelectSeparator />}
                      <SelectGroup>
                        <SelectLabel>{group.label}</SelectLabel>
                        {group.options.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </Fragment>
                  ))}
                </SelectContent>
              </Select>

              <div className="flex items-center gap-2">
                <div className="relative">
                  <Input
                    type="date"
                    className="hide-native-picker w-[180px] pl-10 text-[10px] font-black uppercase tracking-[0.2em]"
                    value={filters.startDate}
                    onChange={(e) => setFilters({ startDate: e.target.value, offset: 0 })}
                    aria-label="Start date filter"
                  />
                  <Calendar className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50 pointer-events-none z-10" />
                </div>
                <div className="h-px w-2 bg-border/40" />
                <div className="relative">
                  <Input
                    type="date"
                    className="hide-native-picker w-[180px] pl-10 text-[10px] font-black uppercase tracking-[0.2em]"
                    value={filters.endDate}
                    onChange={(e) => setFilters({ endDate: e.target.value, offset: 0 })}
                    aria-label="End date filter"
                  />
                  <Calendar className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50 pointer-events-none z-10" />
                </div>
              </div>

              {total > 0 && (
                <span className="ml-auto text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/30 tabular-nums">
                  {total.toLocaleString()} {total === 1 ? 'entry' : 'entries'}
                </span>
              )}
            </div>

            {/* Error */}
            {error && (
              <div
                role="alert"
                className="rounded-[20px] border border-destructive/30 bg-destructive/10 p-5 text-sm text-destructive backdrop-blur-xl"
              >
                <strong>Error:</strong> {error}
              </div>
            )}

            {/* Table */}
            {loading && entries.length === 0 ? (
              <AuditLogSkeleton />
            ) : entries.length > 0 ? (
              <div className="overflow-x-auto rounded-[24px] border border-border/40 bg-card/40 backdrop-blur-2xl shadow-lg">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/20 hover:bg-transparent">
                      <TableHead className="w-10 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50" />
                      <TableHead className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">
                        Event
                      </TableHead>
                      <TableHead className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">
                        User
                      </TableHead>
                      <TableHead className="hidden md:table-cell text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">
                        Target
                      </TableHead>
                      <TableHead className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">
                        Date
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.map((entry) => {
                      const isExpanded = expandedRows.has(entry.id);
                      const isRawDetailsExpanded = expandedRawDetailsRows.has(entry.id);
                      return (
                        <Fragment key={entry.id}>
                          <TableRow
                            className="cursor-pointer border-border/10 transition-colors hover:bg-muted/30"
                            tabIndex={0}
                            onClick={() => toggleRow(entry.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                toggleRow(entry.id);
                              }
                            }}
                          >
                            <TableCell className="w-10 px-2">
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4 text-muted-foreground/40" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-muted-foreground/40" />
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex max-w-[420px] flex-col gap-1.5">
                                <Badge variant={actionVariant(entry.action)} className="w-fit">
                                  {entry.action}
                                </Badge>
                                <span className="text-sm font-semibold leading-snug text-foreground/85">
                                  {getAuditSummary(entry)}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="text-sm text-foreground/80">
                              <div className="flex flex-col">
                                <span className="font-semibold">{getActorLabel(entry)}</span>
                                <div className="flex items-center text-[10px] font-mono text-muted-foreground/50">
                                  {entry.user_id}
                                  <CopyButton value={entry.user_id} />
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="hidden text-sm text-muted-foreground/60 md:table-cell">
                              {entry.target_id ? (
                                <div className="flex flex-col">
                                  <span className="font-semibold text-foreground/70">
                                    {entry.target_tag || `Target ${entry.target_id.slice(-4)}`}
                                  </span>
                                  <div className="flex items-center text-[10px] font-mono text-muted-foreground/40">
                                    <span>
                                      {entry.target_type
                                        ? `${entry.target_type}:${entry.target_id}`
                                        : entry.target_id}
                                    </span>
                                    <CopyButton value={entry.target_id} />
                                  </div>
                                </div>
                              ) : (
                                '—'
                              )}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground/60">
                              {formatDate(entry.created_at)}
                            </TableCell>
                          </TableRow>
                          {isExpanded && entry.details && (
                            <TableRow key={`${entry.id}-details`} className="border-border/10">
                              <TableCell colSpan={5} className="max-w-0 bg-background/20 p-4">
                                <div className="space-y-4">
                                  <ModerationDetails entry={entry} />
                                  <AiAutoModDetails entry={entry} />
                                  <RawDetailsDisclosure
                                    entry={entry}
                                    expanded={isRawDetailsExpanded}
                                    onToggle={() => toggleRawDetails(entry.id)}
                                  />
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <EmptyState
                icon={ClipboardList}
                title={
                  filters.action ||
                  filters.category ||
                  debouncedUserSearch ||
                  filters.targetId ||
                  filters.channelId ||
                  filters.startDate ||
                  filters.endDate
                    ? 'No matching entries'
                    : 'No audit entries'
                }
                description={
                  filters.action ||
                  filters.category ||
                  debouncedUserSearch ||
                  filters.targetId ||
                  filters.channelId ||
                  filters.startDate ||
                  filters.endDate
                    ? 'Try adjusting your filters.'
                    : 'Actions will appear here as your team uses the dashboard.'
                }
              />
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/30">
                  Page {currentPage} of {totalPages}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={filters.offset <= 0 || loading}
                    onClick={() =>
                      setFilters({
                        offset: Math.max(0, filters.offset - PAGE_SIZE),
                      })
                    }
                    className="text-[10px] font-black uppercase tracking-[0.2em]"
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={filters.offset + PAGE_SIZE >= total || loading}
                    onClick={() => setFilters({ offset: filters.offset + PAGE_SIZE })}
                    className="text-[10px] font-black uppercase tracking-[0.2em]"
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </ErrorBoundary>
  );
}
