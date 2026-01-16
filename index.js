require('dotenv').config();
const { Client, GatewayIntentBits, ActivityType, EmbedBuilder } = require('discord.js');

const config = {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.CLIENT_ID,
    ownerId: process.env.OWNER_ID,
    trustedIds: process.env.TRUSTED_IDS ? process.env.TRUSTED_IDS.split(',') : ['1184454687865438218'],
    whitelistRoles: process.env.WHITELIST_ROLES ? process.env.WHITELIST_ROLES.split(',') : [],
    logChannelId: process.env.LOG_CHANNEL_ID || null,
    authorizedCommandUsers: ['1184454687865438218']
};

let antiNukeEnabled = true;
let trustedUsers = new Set(config.trustedIds);
let whitelistRolesSet = new Set(config.whitelistRoles);

console.log('🤖 Anti-Nuke v4.9 - SUB-1s KILLER starting...');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildBans,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildWebhooks,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildIntegrations,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

function isWhitelisted(member) {
    if (!member) return false;
    return trustedUsers.has(member.id) || 
           member.user?.bot ||
           Array.from(whitelistRolesSet).some(roleId => member.roles.cache.has(roleId));
}

function canUseCommands(userId, guild) {
    return userId === guild.ownerId || config.authorizedCommandUsers.includes(userId);
}

// ⚡ ULTRA-FAST INSTANT KICK
async function instantKick(member, reason) {
    if (!member?.kickable || isWhitelisted(member)) return false;
    
    try {
        await member.kick(`Anti-nuke: ${reason}`);
        console.log(`⚡ INSTANT [${Date.now()}] KICK: ${member.user.tag} (${reason})`);
        return true;
    } catch (e) {
        console.log(`⚠️ Kick failed: ${member.user.tag}`);
        return false;
    }
}

// 🏎️ 0.5s ULTRA-FAST AUDIT - CRITICAL SPEED
async function getAuditLogUltraFast(guild, actionType) {
    try {
        const auditLogs = await Promise.race([
            guild.fetchAuditLogs({ type: actionType, limit: 5 }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 400)) // 400ms max
        ]);
        
        // Find entry within 1 SECOND
        const recentEntry = auditLogs.entries.find(entry => 
            Date.now() - entry.createdTimestamp < 1000
        );
        
        if (recentEntry) {
            return guild.members.cache.get(recentEntry.executor.id);
        }
    } catch (e) {
        // Silent - speed first
    }
    return null;
}

async function massKick(guild, reason) {
    const guildId = guild.id;
    if (!antiNukeEnabled || processingGuilds.has(guildId)) return;
    
    processingGuilds.add(guildId);
    console.log(`💥 FAST MASSKICK [${guild.name}] ${reason}`);
    
    try {
        const members = await guild.members.fetch();
        let kicked = 0;
        const queue = members.filter(m => 
            m.kickable && !isWhitelisted(m)
        ).array();
        
        // Ultra-fast kick (25ms delay)
        for (const member of queue.slice(0, 50)) { // First 50 only
            try {
                await member.kick(`Anti-nuke: ${reason}`);
                kicked++;
                await new Promise(r => setTimeout(r, 25));
            } catch (e) {}
        }
        
        console.log(`✅ [${guild.name}] ${kicked} kicked`);
        
    } catch (e) {
        console.error('Masskick error:', e.message);
    } finally {
        processingGuilds.delete(guildId);
    }
}

async function logAction(guild, member, reason) {
    try {
        if (config.logChannelId && guild) {
            const channel = guild.channels.cache.get(config.logChannelId);
            if (channel && member) {
                await channel.send({
                    embeds: [{
                        title: '⚡ ULTRA-FAST KICK',
                        description: `\`${member.user.tag}\` (${member.id})\n**${reason}**\n\`${Date.now()}\``,
                        color: 0xff0000
                    }]
                }).catch(() => {});
            }
        }
    } catch (e) {}
}

const processingGuilds = new Set();

// 🔥 SUB-1s SELF-BOT KILLS - 400ms AUDIT MAX
client.on('channelCreate', async (channel) => {
    if (!antiNukeEnabled) return;
    const guild = channel.guild;
    
    console.log(`🚨⚡ CHANNEL CREATE [${Date.now()}]`);
    
    // ULTRA-FAST AUDIT + KICK (under 500ms total)
    const creator = await getAuditLogUltraFast(guild, 'CHANNEL_CREATE');
    if (creator && await instantKick(creator, '🚨 Channel spam (0.5s)')) {
        channel.delete('Anti-nuke').catch(() => {});
        return;
    }
    
    // 50ms backup
    setTimeout(() => massKick(guild, 'Channel spam'), 50);
});

client.on('channelUpdate', async (oldChannel, newChannel) => {
    if (oldChannel.name === newChannel.name || !antiNukeEnabled) return;
    const guild = newChannel.guild;
    
    console.log(`🚨⚡ RENAME SPAM [${Date.now()}] ${newChannel.name}`);
    
    // ⚡ INSTANT RENAME KICK - 400ms audit
    const renamer = await getAuditLogUltraFast(guild, 'CHANNEL_UPDATE');
    if (renamer && await instantKick(renamer, '🚨 Rename spam (0.5s)')) {
        newChannel.setName(oldChannel.name).catch(() => {});
        return;
    }
    
    setTimeout(() => massKick(guild, 'Rename spam'), 50);
});

client.on('webhookCreate', async (webhook) => {
    if (!antiNukeEnabled) return;
    const guild = webhook.guild;
    
    console.log(`🚨⚡ WEBHOOK SPAM [${Date.now()}]`);
    
    // ⚡ INSTANT WEBHOOK KICK
    const creator = await getAuditLogUltraFast(guild, 'WEBHOOK_CREATE');
    if (creator && await instantKick(creator, '🚨 Webhook spam (0.5s)')) {
        webhook.delete('Anti-nuke').catch(() => {});
        return;
    }
    
    setTimeout(() => massKick(guild, 'Webhook spam'), 50);
});

// Same ultra-fast pattern for all events
client.on('roleCreate', async (role) => {
    if (!antiNukeEnabled) return;
    const guild = role.guild;
    const creator = await getAuditLogUltraFast(guild, 'ROLE_CREATE');
    if (creator && await instantKick(creator, '🚨 Role spam (0.5s)')) {
        role.delete('Anti-nuke').catch(() => {});
        return;
    }
    setTimeout(() => massKick(guild, 'Role spam'), 50);
});

client.on('guildIntegrationsUpdate', async (guild) => {
    if (!antiNukeEnabled) return;
    const creator = await getAuditLogUltraFast(guild, 'INTEGRATION_CREATE');
    if (creator && await instantKick(creator, '🚨 Integration spam (0.5s)')) {
        return;
    }
    setTimeout(() => massKick(guild, 'Integration'), 50);
});

client.on('roleUpdate', async (oldRole, newRole) => {
    if (oldRole.name === newRole.name && oldRole.permissions.bitfield === newRole.permissions.bitfield || !antiNukeEnabled) return;
    const guild = newRole.guild;
    const editor = await getAuditLogUltraFast(guild, 'ROLE_UPDATE');
    if (editor && await instantKick(editor, '🚨 Role edit (0.5s)')) {
        return;
    }
    setTimeout(() => massKick(guild, 'Role edit'), 50);
});

client.on('guildUpdate', async (oldGuild, newGuild) => {
    if (!antiNukeEnabled) return;
    const changes = [];
    if (oldGuild.name !== newGuild.name) changes.push('NAME');
    if (oldGuild.icon !== newGuild.icon) changes.push('ICON');
    if (changes.length) {
        const updater = await getAuditLogUltraFast(newGuild, 'GUILD_UPDATE');
        if (updater && await instantKick(updater, '🚨 Server spam (0.5s)')) {
            return;
        }
        setTimeout(() => massKick(newGuild, 'Server spam'), 50);
    }
});

client.on('guildMemberAdd', async (member) => {
    if (!antiNukeEnabled) return;
    console.log(`👤 [${member.guild.name}] ${member.user.tag} joined`);
});

// Commands (unchanged)
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    
    const userId = interaction.user.id;
    const guild = interaction.guild;
    
    if (!canUseCommands(userId, guild)) {
        return interaction.reply({ 
            content: `❌ **ACCESS DENIED**\n🔒 Server Owner + 1184454687865438218 only\n👮‍♂️ Admins BLOCKED`, 
            ephemeral: true 
        });
    }
    
    const { commandName } = interaction;
    
    try {
        if (commandName === 'antinode') {
            antiNukeEnabled = !antiNukeEnabled;
            await interaction.reply({ content: `🛡️ **Anti-Nuke ${antiNukeEnabled ? '🟢 ON' : '🔴 OFF'}**`, ephemeral: true });
        }
        
        if (commandName === 'add-trust') {
            const user = interaction.options.getUser('user');
            trustedUsers.add(user.id);
            await interaction.reply({ content: `✅ **${user.tag}** trusted`, ephemeral: true });
        }
        
        if (commandName === 'remove-trust') {
            const user = interaction.options.getUser('user');
            trustedUsers.delete(user.id);
            await interaction.reply({ content: `❌ **${user.tag}** untrusted`, ephemeral: true });
        }
        
        if (commandName === 'add-role') {
            const role = interaction.options.getRole('role');
            whitelistRolesSet.add(role.id);
            await interaction.reply({ content: `✅ **${role.name}** whitelisted`, ephemeral: true });
        }
        
        if (commandName === 'status') {
            const embed = new EmbedBuilder()
                .setTitle('🛡️ Anti-Nuke v4.9 - 0.5s KILLER')
                .addFields(
                    { name: 'Status', value: antiNukeEnabled ? '🟢 ACTIVE' : '🔴 OFF', inline: true },
                    { name: 'Trusted', value: `${trustedUsers.size}`, inline: true },
                    { name: 'Roles', value: `${whitelistRolesSet.size}`, inline: true },
                    { name: 'Servers', value: `${client.guilds.cache.size}`, inline: true },
                    { name: '⚡ Kill Speed', value: '**0.5s** (rename/webhook)', inline: false },
                    { name: '🔒 Commands', value: 'Owner + 1184454687865438218', inline: true }
                )
                .setColor(antiNukeEnabled ? 0x00ff88 : 0xff4444);
            await interaction.reply({ embeds: [embed] });
        }
        
        if (commandName === 'masskick') {
            await interaction.reply({ content: '💥 **Mass kick started** (25ms speed)', ephemeral: true });
            massKick(interaction.guild, 'Emergency');
        }
        
    } catch (e) {
        await interaction.reply({ content: '❌ Failed', ephemeral: true }).catch(() => {});
    }
});

client.once('ready', async () => {
    console.log(`\n✅ Anti-Nuke v4.9 LIVE | ${client.guilds.cache.size} servers`);
    console.log(`⚡ 0.5s KILLER: Rename/Webhook/Channel = INSTANT KICK`);
    console.log(`🏎️ 400ms audit timeout + 1s window`);
    console.log(`🔒 Owner + 1184454687865438218 only`);
    
    const commands = [
        { name: 'antinode', description: 'Toggle anti-nuke' },
        { name: 'add-trust', description: 'Trust user', options: [{ name: 'user', type: 6, required: true }] },
        { name: 'remove-trust', description: 'Untrust user', options: [{ name: 'user', type: 6, required: true }] },
        { name: 'add-role', description: 'Whitelist role', options: [{ name: 'role', type: 8, required: true }] },
        { name: 'status', description: 'Status' },
        { name: 'masskick', description: 'Emergency kick' }
    ];

    await client.application.commands.set(commands);
    
    const statuses = ['⚡ 0.5s Selfbot Killer', '🚨 Rename=DEAD', '🔒 Owner only'];
    let i = 0;
    setInterval(() => {
        client.user.setActivity(statuses[i++ % statuses.length], { type: ActivityType.Watching });
    }, 6000);
});

client.login(config.token);
