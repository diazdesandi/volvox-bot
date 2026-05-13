'use client';

import { Bot, RefreshCw, Server, Users } from 'lucide-react';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useBotInvite } from '@/hooks/use-bot-invite';
import { getGuildDashboardRole, isGuildManageable } from '@/hooks/use-guild-role';
import { broadcastSelectedGuild } from '@/lib/guild-selection';
import { sortGuildsByName } from '@/lib/guild-sort';
import { cn } from '@/lib/utils';
import type { MutualGuild } from '@/types/discord';
import { useGuildDirectory } from '../layout/guild-directory-context';

interface WelcomeServerPickerProps {
  readonly autoSelectGuildId?: string | null;
  readonly className?: string;
  readonly error: boolean;
  readonly guilds: MutualGuild[];
  readonly loading: boolean;
  readonly onRefresh: () => Promise<void> | void;
}

const memberCountFormatter = new Intl.NumberFormat(undefined);
const serverListGridClassName = 'md:grid-cols-[minmax(0,1fr)_8rem_10rem_9rem]';

function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${memberCountFormatter.format(count)} ${count === 1 ? singular : plural}`;
}

function formatMemberCount(memberCount: number | null | undefined): string {
  if (typeof memberCount !== 'number') {
    return 'Members unavailable';
  }

  return formatCount(memberCount, 'member');
}

function formatNeedsBotCount(count: number): string {
  return `${memberCountFormatter.format(count)} ${count === 1 ? 'needs' : 'need'} bot`;
}

function getServerSummary(guilds: MutualGuild[], manageableGuilds: MutualGuild[]): string {
  const installedCount = guilds.filter((guild) => guild.botPresent).length;
  const needsBotCount = manageableGuilds.filter((guild) => !guild.botPresent).length;

  return `${formatCount(guilds.length, 'server')} found, ${installedCount} installed, ${formatNeedsBotCount(needsBotCount)}`;
}

function getRoleLabel(guild: MutualGuild): string {
  const role = getGuildDashboardRole(guild);
  if (role === 'owner') return 'Owner';
  if (role === 'admin') return 'Admin';
  if (role === 'moderator') return 'Moderator';
  return 'Viewer';
}

function isBotInstalledOrPresenceDegraded(guild: MutualGuild): boolean {
  return guild.botPresent || guild.botPresenceAuthoritative === false;
}

function GuildAvatar({ guild }: { readonly guild: MutualGuild }) {
  if (guild.icon) {
    return (
      <Image
        src={guild.icon}
        alt=""
        width={40}
        height={40}
        className="h-10 w-10 rounded-[12px] object-cover shadow-inner"
      />
    );
  }

  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-[12px] border border-border/40 bg-muted/20 text-muted-foreground/40 shadow-inner">
      <Server className="h-5 w-5" />
    </div>
  );
}

function ManageButton({
  guild,
  onManage,
}: {
  readonly guild: MutualGuild;
  readonly onManage: () => void;
}) {
  return (
    <Button
      variant="default"
      size="sm"
      className="w-full md:w-auto"
      aria-label={`Manage ${guild.name}`}
      onClick={onManage}
    >
      Manage
    </Button>
  );
}

function AddBotButton({
  guild,
  onAddBot,
}: {
  readonly guild: MutualGuild;
  readonly onAddBot: () => void;
}) {
  return (
    <Button
      variant="discord"
      size="sm"
      className="w-full gap-2 md:w-auto"
      aria-label={`Add bot to ${guild.name}`}
      onClick={onAddBot}
    >
      <Bot className="h-4 w-4" />
      Add Bot
    </Button>
  );
}

function WelcomeFrame({
  children,
  className,
}: {
  readonly children: React.ReactNode;
  readonly className?: string;
}) {
  return (
    <section className={cn('dashboard-fade-in mx-auto w-full max-w-5xl space-y-6', className)}>
      {children}
    </section>
  );
}

function SetupPanel({ children }: { readonly children: React.ReactNode }) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-[28px] border border-border/40 bg-card/40 backdrop-blur-3xl',
        'shadow-[inset_0_1px_1px_rgba(255,255,255,0.1),0_24px_48px_-12px_rgba(0,0,0,0.4)]',
        'before:absolute before:inset-0 before:bg-gradient-to-b before:from-white/[0.02] before:to-transparent before:pointer-events-none',
      )}
    >
      <div className="absolute top-0 right-0 h-32 w-32 -translate-y-12 translate-x-12 rounded-full bg-primary/5 blur-3xl pointer-events-none" />
      <div className="relative z-10">{children}</div>
    </div>
  );
}

function RefreshButton({ onRefresh }: { readonly onRefresh: () => Promise<void> | void }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="gap-2"
      onClick={() => void onRefresh()}
    >
      <RefreshCw className="h-4 w-4" />
      Refresh
    </Button>
  );
}

function PageHeader({
  onRefresh,
  summary,
}: {
  readonly onRefresh: () => Promise<void> | void;
  readonly summary: string;
}) {
  return (
    <header className="flex flex-col gap-4 border-b border-border/30 px-6 py-8 sm:px-8 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl md:text-3xl font-black tracking-tight text-foreground">
          Set up <span className="text-primary">Volvox.Bot</span>
        </h1>
        <p className="mt-3 max-w-2xl text-[15px] font-medium leading-relaxed text-muted-foreground/80">
          Choose a Discord server below. Manage opens servers that already have the bot; Add Bot
          starts the install flow.
        </p>
        <div className="mt-5 flex items-center gap-3">
          <div className="flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-primary ring-1 ring-primary/20">
            <span className="status-dot-live h-1 w-1" />
            Live Discovery
          </div>
          <section
            aria-label="Server summary"
            className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/30"
          >
            {summary}
          </section>
        </div>
      </div>
      <RefreshButton onRefresh={onRefresh} />
    </header>
  );
}

function ViewerOnlyServers({ guilds }: { readonly guilds: MutualGuild[] }) {
  if (guilds.length === 0) return null;

  return (
    <section className="border-t border-border/60 pt-8">
      <div className="flex items-center gap-2 mb-2">
        <div className="h-1 w-1 rounded-full bg-muted-foreground/30" />
        <h2 className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground/60">
          Viewer-only access
        </h2>
      </div>
      <p className="mb-4 text-sm text-muted-foreground/60">
        Use a Discord account with owner, admin, or moderator access to manage these servers.
      </p>
      <div
        className={cn(
          'overflow-hidden rounded-[24px] border border-border/30 bg-muted/5 backdrop-blur-xl',
          'shadow-[inset_0_1px_1px_rgba(255,255,255,0.05),0_8px_16px_-4px_rgba(0,0,0,0.2)]',
        )}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Server</TableHead>
              <TableHead className="text-right pr-4">Members</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {guilds.map((guild) => (
              <TableRow key={guild.id}>
                <TableCell className="flex items-center gap-3 pl-4">
                  <GuildAvatar guild={guild} />
                  <span className="truncate font-medium text-foreground">{guild.name}</span>
                </TableCell>
                <TableCell className="text-right pr-4 text-muted-foreground">
                  {formatMemberCount(guild.memberCount)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

function InviteUnavailableMessage() {
  return (
    <span className="block max-w-48 text-xs leading-5 text-muted-foreground">
      Invite link unavailable. Check{' '}
      <code className="text-[0.7rem]">NEXT_PUBLIC_DISCORD_CLIENT_ID</code>.
    </span>
  );
}

interface ServerRowProps {
  readonly guild: MutualGuild;
  readonly isInviteConfigured: boolean;
  readonly onAddBot: () => void;
  readonly onManage: () => void;
}

function ServerRow({ guild, isInviteConfigured, onAddBot, onManage }: ServerRowProps) {
  return (
    <article
      data-testid={`server-picker-row-${guild.id}`}
      className={cn(
        'group grid gap-3 px-6 py-5 md:items-center md:gap-0 transition-colors hover:bg-primary/[0.02]',
        serverListGridClassName,
      )}
    >
      <div className="flex min-w-0 items-center gap-4">
        <div className="relative h-10 w-10 shrink-0">
          <GuildAvatar guild={guild} />
          <div className="absolute inset-0 rounded-lg ring-1 ring-inset ring-white/5" />
        </div>
        <div className="min-w-0">
          <h2 className="truncate text-sm font-bold tracking-tight text-foreground">
            {guild.name}
          </h2>
          <div className="mt-1 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground/60 md:hidden">
            <Users className="h-3.5 w-3.5" />
            {formatMemberCount(guild.memberCount)}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="h-1 w-1 rounded-full bg-primary/40 md:hidden" />
        <span className="text-[11px] font-black uppercase tracking-wider text-muted-foreground/40">
          {getRoleLabel(guild)}
        </span>
      </div>
      <div className="hidden items-center gap-2 text-xs font-bold text-muted-foreground/40 md:flex">
        <Users className="h-3.5 w-3.5 opacity-40" />
        {formatMemberCount(guild.memberCount)}
      </div>
      <div className="md:justify-self-end">
        {guild.botPresent ? (
          <ManageButton guild={guild} onManage={onManage} />
        ) : isInviteConfigured ? (
          <AddBotButton guild={guild} onAddBot={onAddBot} />
        ) : (
          <InviteUnavailableMessage />
        )}
      </div>
    </article>
  );
}

export function WelcomeServerPicker({
  autoSelectGuildId,
  className,
  error,
  guilds,
  loading,
  onRefresh,
}: WelcomeServerPickerProps) {
  const router = useRouter();
  const handledAutoSelectGuildIdRef = useRef<string | null>(null);
  const { inviteBot, isInviteConfigured } = useBotInvite();
  const { manageableGuilds, serverSummary, viewerOnlyGuilds } = useMemo(() => {
    const nextManageableGuilds = sortGuildsByName(guilds.filter(isGuildManageable));

    return {
      manageableGuilds: nextManageableGuilds,
      serverSummary: getServerSummary(guilds, nextManageableGuilds),
      viewerOnlyGuilds: sortGuildsByName(guilds.filter((guild) => !isGuildManageable(guild))),
    };
  }, [guilds]);

  const handleManage = useCallback(
    (guild: MutualGuild) => {
      broadcastSelectedGuild(guild.id);
      router.push('/dashboard');
    },
    [router],
  );

  useEffect(() => {
    const normalizedGuildId = autoSelectGuildId?.trim();
    if (!normalizedGuildId || loading || error) return;
    if (handledAutoSelectGuildIdRef.current === normalizedGuildId) return;

    const guild = guilds.find((candidate) => candidate.id === normalizedGuildId);
    if (!guild || !isGuildManageable(guild) || !isBotInstalledOrPresenceDegraded(guild)) return;

    handledAutoSelectGuildIdRef.current = normalizedGuildId;
    handleManage(guild);
  }, [autoSelectGuildId, error, guilds, handleManage, loading]);

  const handleAddBot = (guild: MutualGuild) => {
    inviteBot(guild.id);
  };

  if (loading) {
    return (
      <WelcomeFrame className={className}>
        <SetupPanel>
          <div
            role="status"
            className="flex items-center gap-3 px-4 py-5 text-sm text-muted-foreground sm:px-5"
          >
            <RefreshCw className="h-4 w-4 animate-spin" />
            Loading server access...
          </div>
        </SetupPanel>
      </WelcomeFrame>
    );
  }

  if (error) {
    return (
      <WelcomeFrame className={className}>
        <SetupPanel>
          <PageHeader onRefresh={onRefresh} summary={serverSummary} />
          <div className="px-4 py-5 sm:px-5">
            <h2 className="text-sm font-semibold text-foreground">Couldn&apos;t load servers</h2>
            <p className="mt-1 text-sm text-muted-foreground">Refresh the list and try again.</p>
          </div>
        </SetupPanel>
      </WelcomeFrame>
    );
  }

  if (manageableGuilds.length === 0) {
    return (
      <WelcomeFrame className={className}>
        <SetupPanel>
          <PageHeader onRefresh={onRefresh} summary={serverSummary} />
          <div className="px-4 py-5 sm:px-5">
            <h2 className="text-sm font-semibold text-foreground">No servers you can manage</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              You need owner, admin, or moderator access in Discord before this account can set up
              Volvox.Bot.
            </p>
          </div>
        </SetupPanel>
        <ViewerOnlyServers guilds={viewerOnlyGuilds} />
      </WelcomeFrame>
    );
  }

  return (
    <WelcomeFrame className={className}>
      <SetupPanel>
        <PageHeader onRefresh={onRefresh} summary={serverSummary} />
        <div
          className={cn(
            'hidden border-b border-border/20 px-8 py-3 text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground/40 md:grid',
            serverListGridClassName,
          )}
        >
          <div>Server</div>
          <div>Role</div>
          <div>Members</div>
          <div />
        </div>
        <div className="stagger-fade-in divide-y divide-border/20">
          {manageableGuilds.map((guild) => (
            <ServerRow
              key={guild.id}
              guild={guild}
              isInviteConfigured={isInviteConfigured}
              onAddBot={() => handleAddBot(guild)}
              onManage={() => handleManage(guild)}
            />
          ))}
        </div>
      </SetupPanel>

      <ViewerOnlyServers guilds={viewerOnlyGuilds} />
    </WelcomeFrame>
  );
}

export function ConnectedWelcomeServerPicker() {
  const searchParams = useSearchParams();
  const { error, guilds, loading, refreshGuilds } = useGuildDirectory();

  return (
    <WelcomeServerPicker
      autoSelectGuildId={searchParams.get('guildId')}
      error={error}
      guilds={guilds}
      loading={loading}
      onRefresh={refreshGuilds}
    />
  );
}
