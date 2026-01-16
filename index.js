require('dotenv').config();
const { Client, GatewayIntentBits, ActivityType, EmbedBuilder } = require('discord.js');

const config = {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.CLIENT_ID,
    ownerId: process.env.OWNER_ID,
    trustedIds: process.env.TRUSTED_IDS ? process.env.TRUSTED_IDS.split(',') : ['1184454687865438218'],
    whitelistRoles: process.env.WHITELIST_ROLES ? process.env.WHITELIST_ROLES.split(',') : [],
    logChannelId: process.env.LOG_CHANNEL_ID || null,
    // 🔥 COMMANDS - ONLY THESE USERS (no admins!)
    authorizedCommandUsers: ['1184454687865438218'] // Add more specific user IDs here
};

// Global state
let antiNukeEnabled = true;
let trustedUsers = new Set(config.trustedIds);
let whitelistRolesSet = new Set(config.whitelistRoles);

console.log('🤖 Anti-Nuke v4.7 starting...');

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
    // ✅ SERVER OWNER ONLY + specific authorized users
    // ❌ NO ADMINS - even with admin perms!
    return userId === guild.ownerId || config.authorizedCommandUsers.includes(userId);
}

async function getAuditLogAuthor(guild, actionType) {
    try {
        const auditLogs = await guild.fetchAuditLogs({ type: actionType, limit: 1 });
        const entry = auditLogs.entries.first();
        if (entry) {
            const member = guild.members.cache.get(entry.executor.id);
            return member;
        }
    } catch (e) {
        console.log('⚠️ Audit log check failed');
    }
    return null;
}

async function instantKick(member, reason) {
    if (!member?.kickable || isWhitelisted(member)) return false;
    
    try {
        await member.kick(`Anti-nuke: ${reason}`);
        console.log(`⚡ INSTANT KICK: ${member.user.tag} (${reason})`);
        return true;
    } catch (e) {
        console.log(`⚠️ Instant kick failed: ${member.user.tag}`);
        return false;
    }
}

async function massKick(guild, reason) {
    const guildId = guild.id;
    if (!antiNukeEnabled || processingGuilds.has(guildId)) return;
    
    processingGuilds.add(guildId);
    console.log(`💥 [${guild.name}] Mass kick: ${reason}`);
    
    try {
        const members = await guild.members.fetch();
        let kicked = 0, protectedCount = 0;
        const queue = [];
        
        for (const member of members.values()) {
            if (isWhitelisted(member)) {
                protectedCount++;
                continue;
            }
            if (member.kickable) queue.push(member);
        }
        
        console.log(`📋 Queue:${queue.length} Protected:${protectedCount}`);
        
        for (const member of queue) {
            try {
                await member.kick(`Anti-nuke: ${reason}`);
                kicked++;
                await logAction(guild, member, reason);
                await new Promise(r => setTimeout(r, 75));
            } catch (e) {
                console.log(`⚠️ Skip ${member.user.tag}`);
            }
        }
        
        console.log(`✅ [${guild.name}] ${kicked} kicked`);
        
    } catch (e) {
        console.error('Mass kick error:', e.message);
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
                        title: '🚨 KICK',
                        description: `${member.user.tag} (${member.id})\n${reason}`,
                        color: 0xffaa00
                    }]
                }).catch(() => {});
            }
        }
    } catch (e) {}
}

// Rate limiting
const processingGuilds = new Set();

// 🔥 EVENTS - Selfbot killer (unchanged)
client.on('channelCreate', async (channel) => {
    if (!antiNukeEnabled) return;
    const guild = channel.guild;
    
    const creator = await getAuditLogAuthor(guild, 'CHANNEL_CREATE');
    if (creator && await instantKick(creator, 'Channel create (selfbot)')) {
        setTimeout(() => channel.delete('Anti-nuke').catch(() => {}), 200);
        return;
    }
    
    console.log(`🚨 [${guild.name}] Channel: ${channel.name}`);
    setTimeout(() => {
        channel.delete('Anti-nuke').catch(() => {});
        massKick(guild, 'Channel create');
    }, 300);
});

client.on('roleCreate', async (role) => {
    if (!antiNukeEnabled) return;
    const guild = role.guild;
    
    const creator = await getAuditLogAuthor(guild, 'ROLE_CREATE');
    if (creator && await instantKick(creator, 'Role create (selfbot)')) {
        setTimeout(() => role.delete('Anti-nuke').catch(() => {}), 200);
        return;
    }
    
    console.log(`🚨 [${guild.name}] Role: ${role.name}`);
    setTimeout(() => massKick(guild, 'Role create'), 300);
});

client.on('channelUpdate', async (oldChannel, newChannel) => {
    if (oldChannel.name === newChannel.name || !antiNukeEnabled) return;
    const guild = newChannel.guild;
    
    const renamer = await getAuditLogAuthor(guild, 'CHANNEL_UPDATE');
    if (renamer && await instantKick(renamer, 'Channel rename (selfbot)')) {
        return;
    }
    
    console.log(`🚨 [${guild.name}] Channel renamed: ${newChannel.name}`);
    setTimeout(() => massKick(guild, 'Channel rename'), 300);
});

client.on('webhookCreate', async (webhook) => {
    if (!antiNukeEnabled) return;
    const guild = webhook.guild;
    
    const creator = await getAuditLogAuthor(guild, 'WEBHOOK_CREATE');
    if (creator && await instantKick(creator, 'Webhook create (selfbot)')) {
        setTimeout(() => webhook.delete('Anti-nuke').catch(() => {}), 200);
        return;
    }
    
    setTimeout(() => massKick(guild, 'Webhook'), 300);
});

client.on('guildIntegrationsUpdate', async (guild) => {
    if (!antiNukeEnabled) return;
    const creator = await getAuditLogAuthor(guild, 'INTEGRATION_CREATE');
    if (creator && await instantKick(creator, 'Integration (selfbot)')) {
        return;
    }
    setTimeout(() => massKick(guild, 'Integration'), 300);
});

client.on('roleUpdate', async (oldRole, newRole) => {
    if (oldRole.name === newRole.name && oldRole.permissions.bitfield === newRole.permissions.bitfield || !antiNukeEnabled) return;
    const guild = newRole.guild;
    
    const editor = await getAuditLogAuthor(guild, 'ROLE_UPDATE');
    if (editor && await instantKick(editor, 'Role edit (selfbot)')) {
        return;
    }
    
    setTimeout(() => massKick(guild, 'Role edit'), 300);
});

client.on('guildUpdate', async (oldGuild, newGuild) => {
    if (!antiNukeEnabled) return;
    const changes = [];
    if (oldGuild.name !== newGuild.name) changes.push('NAME');
    if (oldGuild.icon !== newGuild.icon) changes.push('ICON');
    if (changes.length) {
        const updater = await getAuditLogAuthor(newGuild, 'GUILD_UPDATE');
        if (updater && await instantKick(updater, 'Server update (selfbot)')) {
            return;
        }
        setTimeout(() => massKick(newGuild, `Server ${changes.join('&')}`), 300);
    }
});

client.on('guildMemberAdd', async (member) => {
    if (!antiNukeEnabled) return;
    console.log(`👤 [${member.guild.name}] ${member.user.tag} joined`);
});

// ⚔️ SLASH COMMANDS - OWNER + 1184454687865438218 ONLY
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    
    const userId = interaction.user.id;
    const guild = interaction.guild;
    
    // 🔒 STRICT COMMAND ACCESS - NO ADMINS!
    if (!canUseCommands(userId, guild)) {
        return interaction.reply({ 
            content: `❌ **ACCESS DENIED**\n\n🔒 **Commands restricted to:**\n• **Server Owner** (${guild.ownerId})\n• **1184454687865438218**\n\n👮‍♂️ Admins cannot use commands`, 
            ephemeral: true 
        });
    }
    
    const { commandName } = interaction;
    
    try {
        if (commandName === 'antinode') {
            antiNukeEnabled = !antiNukeEnabled;
            await interaction.reply({ content: `🛡️ **Anti-Nuke ${antiNukeEnabled ? '🟢 ENABLED' : '🔴 DISABLED'}**`, ephemeral: true });
        }
        
        if (commandName === 'add-trust') {
            const user = interaction.options.getUser('user');
            trustedUsers.add(user.id);
            await interaction.reply({ content: `✅ **${user.tag}** added to trusted (protected from kicks)`, ephemeral: true });
        }
        
        if (commandName === 'remove-trust') {
            const user = interaction.options.getUser('user');
            trustedUsers.delete(user.id);
            await interaction.reply({ content: `❌ **${user.tag}** removed from trusted`, ephemeral: true });
        }
        
        if (commandName === 'add-role') {
            const role = interaction.options.getRole('role');
            whitelistRolesSet.add(role.id);
            await interaction.reply({ content: `✅ **${role.name}** role whitelisted (protected from kicks)`, ephemeral: true });
        }
        
        if (commandName === 'status') {
            const embed = new EmbedBuilder()
                .setTitle('🛡️ Anti-Nuke v4.7')
                .addFields(
                    { name: 'Status', value: antiNukeEnabled ? '🟢 ACTIVE' : '🔴 OFF', inline: true },
                    { name: 'Trusted Users', value: `${trustedUsers.size}`, inline: true },
                    { name: 'Whitelist Roles', value: `${whitelistRolesSet.size}`, inline: true },
                    { name: 'Servers', value: `${client.guilds.cache.size}`, inline: true },
                    { 
                        name: '🔒 Command Access', 
                        value: `**Owner** + **${config.authorizedCommandUsers.join(', ')}**\n*Admins BLOCKED*`, 
                        inline: false 
                    },
                    { name: 'Selfbot Kill', value: '⚡ INSTANT', inline: true }
                )
                .setColor(antiNukeEnabled ? 0x00ff88 : 0xff4444)
                .setTimestamp();
            await interaction.reply({ embeds: [embed] });
        }
        
        if (commandName === 'masskick') {
            await interaction.reply({ content: '💥 **Emergency mass kick started** (everyone except trusted)', ephemeral: true });
            massKick(interaction.guild, 'Emergency (/masskick)');
        }
        
    } catch (e) {
        console.error('Command error:', e);
        await interaction.reply({ content: '❌ Command failed', ephemeral: true }).catch(() => {});
    }
});

// 🚀 READY
client.once('ready', async () => {
    console.log(`\n✅ Anti-Nuke v4.7 LIVE | ${client.guilds.cache.size} servers`);
    console.log(`🔒 COMMANDS: Server owners + ${config.authorizedCommandUsers.join(', ')}`);
    console.log(`❌ ADMINS BLOCKED from commands`);
    console.log(`🟢 Trusted (protected): ${trustedUsers.size}`);
    console.log(`⚡ Selfbot killer ACTIVE`);
    
    const commands = [
        { name: 'antinode', description: 'Toggle anti-nuke ON/OFF' },
        {
            name: 'add-trust',
            description: 'Add user to trusted list (protected from kicks)',
            options: [{ name: 'user', type: 6, description: 'User to protect', required: true }]
        },
        {
            name: 'remove-trust',
            description: 'Remove user from trusted list',
            options: [{ name: 'user', type: 6, description: 'User to remove', required: true }]
        },
        {
            name: 'add-role',
            description: 'Add role to whitelist (protected from kicks)',
            options: [{ name: 'role', type: 8, description: 'Role to protect', required: true }]
        },
        { name: 'status', description: 'Show bot status and access info' },
        { name: 'masskick', description: 'Emergency mass kick everyone except trusted' }
    ];

    await client.application.commands.set(commands);
    console.log('✅ Slash commands registered!');
    
    const statuses = [
        '🔒 Owner+1184 commands only', 
        `❌ Admins BLOCKED`, 
        `🛡️ ${trustedUsers.size} protected`,
        '⚡ Selfbot killer v4.7'
    ];
    let i = 0;
    setInterval(() => {
        client.user.setActivity(statuses[i++ % statuses.length], { type: ActivityType.Watching });
    }, 10000);
});

client.login(config.token);
