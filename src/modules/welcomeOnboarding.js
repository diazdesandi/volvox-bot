import { ActionRowBuilder, ButtonBuilder, ButtonStyle, GuildMemberFlagsBitField } from 'discord.js';
import { info } from '../logger.js';
import { fetchChannelCached } from '../utils/discordCache.js';
import { safeEditReply, safeSend } from '../utils/safeSend.js';
import { renderTemplate } from '../utils/templateEngine.js';

export const RULES_ACCEPT_BUTTON_ID = 'welcome_rules_accept';
export const DEFAULT_RULES_AGREEMENT_MESSAGE =
  'Read the server rules, then click below to verify your access.';
export const DEFAULT_INTRODUCTION_MESSAGE =
  'Welcome {{user}}! Drop a quick intro so we can meet you.';

function getTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getOptionalString(value) {
  return getTrimmedString(value) || null;
}

function getStringOrDefault(value, fallback) {
  return getTrimmedString(value) || fallback;
}

function normalizeDmSteps(steps) {
  if (!Array.isArray(steps)) return [];

  return steps.map((step) => String(step || '').trim()).filter(Boolean);
}

/**
 * Normalize welcome onboarding settings and apply safe defaults.
 *
 * @param {object} welcomeConfig
 * @returns {{
 *   rulesChannel: string|null,
 *   verifiedRole: string|null,
 *   introChannel: string|null,
 *   rulesMessage: string,
 *   introMessage: string,
 *   dmSequence: {enabled: boolean, steps: string[]},
 * }}
 */
export function normalizeWelcomeOnboardingConfig(welcomeConfig = {}) {
  return {
    rulesChannel: getOptionalString(welcomeConfig?.rulesChannel),
    verifiedRole: getOptionalString(welcomeConfig?.verifiedRole),
    introChannel: getOptionalString(welcomeConfig?.introChannel),
    rulesMessage: getStringOrDefault(welcomeConfig?.rulesMessage, DEFAULT_RULES_AGREEMENT_MESSAGE),
    introMessage: getStringOrDefault(welcomeConfig?.introMessage, DEFAULT_INTRODUCTION_MESSAGE),
    dmSequence: {
      enabled: welcomeConfig?.dmSequence?.enabled === true,
      steps: normalizeDmSteps(welcomeConfig?.dmSequence?.steps),
    },
  };
}

/**
 * Check whether a guild member is rejoining (has the DidRejoin flag).
 *
 * @param {import('discord.js').GuildMember} member - The guild member to check.
 * @returns {boolean} `true` if the member has previously left and is rejoining the guild.
 */
export function isReturningMember(member) {
  return member?.flags?.has?.(GuildMemberFlagsBitField.Flags.DidRejoin) === true;
}

export function buildRulesAgreementMessage(welcomeConfig = {}) {
  const onboarding = normalizeWelcomeOnboardingConfig(welcomeConfig);
  const button = new ButtonBuilder()
    .setCustomId(RULES_ACCEPT_BUTTON_ID)
    .setLabel('Accept Rules')
    .setStyle(ButtonStyle.Success);

  const row = new ActionRowBuilder().addComponents(button);

  return {
    content: onboarding.rulesMessage,
    components: [row],
  };
}

export function renderIntroductionMessage(template, member, guild) {
  return renderTemplate(template || DEFAULT_INTRODUCTION_MESSAGE, {
    user: `<@${member.id}>`,
    username: member.user?.username || member.username || 'Unknown',
    server: guild?.name ?? '',
  });
}

async function fetchRole(guild, roleId) {
  return guild.roles.cache.get(roleId) || (await guild.roles.fetch(roleId).catch(() => null)); // roles.cache is in-memory; fetch only on miss
}

export async function handleRulesAcceptButton(interaction, config) {
  await interaction.deferReply({ ephemeral: true });
  const welcome = normalizeWelcomeOnboardingConfig(config?.welcome);

  if (!welcome.verifiedRole) {
    await safeEditReply(interaction, {
      content: '⚠️ Verified role is not configured yet. Ask an admin to set `welcome.verifiedRole`.',
    });
    return;
  }

  const member = interaction.member || (await interaction.guild.members.fetch(interaction.user.id));
  const role = await fetchRole(interaction.guild, welcome.verifiedRole);

  if (!role) {
    await safeEditReply(interaction, {
      content:
        '❌ I cannot find the configured verified role. Ask an admin to fix onboarding config.',
    });
    return;
  }

  if (!role.editable) {
    await safeEditReply(interaction, {
      content: '❌ I cannot assign the verified role (it is above my highest role).',
    });
    return;
  }

  if (member.roles.cache.has(role.id)) {
    await safeEditReply(interaction, {
      content: '✅ You are already verified.',
    });
    return;
  }

  try {
    await member.roles.add(role, 'Accepted server rules');
  } catch (roleErr) {
    info('Failed to assign verified role during rules acceptance', {
      guildId: interaction.guildId,
      userId: interaction.user.id,
      roleId: role.id,
      error: roleErr?.message,
    });
    await safeEditReply(interaction, {
      content: '❌ Failed to assign the verified role. Please try again or contact an admin.',
    });
    return;
  }

  if (welcome.introChannel) {
    const introChannel = await fetchChannelCached(interaction.client, welcome.introChannel);

    if (introChannel?.isTextBased?.()) {
      await safeSend(
        introChannel,
        renderIntroductionMessage(welcome.introMessage, member, interaction.guild),
      );
    }
  }

  if (welcome.dmSequence.enabled && welcome.dmSequence.steps.length > 0) {
    for (const step of welcome.dmSequence.steps) {
      try {
        await interaction.user.send(step);
      } catch (dmErr) {
        info('DM delivery failed during onboarding sequence', {
          guildId: interaction.guildId,
          userId: interaction.user.id,
          error: dmErr?.message,
        });
        break;
      }
    }
  }

  await safeEditReply(interaction, {
    content: `✅ Rules accepted! You now have <@&${role.id}>.`,
  });

  info('User verified via rules button', {
    guildId: interaction.guildId,
    userId: interaction.user.id,
    roleId: role.id,
  });
}
