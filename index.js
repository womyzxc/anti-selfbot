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

// Rate limiting
const rateLimits = new Map();
const processingGuilds = new Set();
const recentJoins = new Map();
const joinGracePeriod = 10000; // 10 seconds

console.log('🤖 Anti-Nuke v4.2 starting...');

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
    return trustedUsers.has(member.id) || 
           member.user.bot ||
           Array.from(whitelistRolesSet).some(roleId => member.roles.cache.has(roleId));
}

function canKick(guildId) {
    const now = Date.now();
    const guildData = rateLimits.get(guildId);
    return !guildData || now >= guildData.nextKick;
}

function isSuspiciousJoin(member) {
    const joinTime = recentJoins.get(member.id);
    if (!joinTime) return false;
    const age = Date.now() - joinTime;
    return age > joinGracePeriod && !isWhitelisted(member);
}

async function massKick(guild, reason) {
    const guildId = guild.id;
    if (!antiNukeEnabled || trustedUsers.has(guild.ownerId) || processingGuilds.has(guildId)) {
        return;
    }
    
    processingGuilds.add(guildId);
    console.log(`💥 [${guild.name}] Mass kick: ${reason}`);
    
    try {
        const members = await guild.members.fetch();
        let kicked = 0, protectedCount = 0, graceCount = 0;
        const queue = [];
        
        for (const member of members.values()) {
            if (isWhitelisted(member)) {
                protectedCount++;
                continue;
            }
            
            if (recentJoins.has(member.id) && (Date.now() - recentJoins.get(member.id)) < joinGracePeriod) {
                graceCount++;
                continue;
            }
            
            if (member.kickable) queue.push(member);
        }
        
        console.log(`📋 Queue:${queue.length} Protected:${protectedCount} Grace:${graceCount}`);
        
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

// 🔥 EVENTS
client.on('guildMemberAdd', async (member) => {
    if (!antiNukeEnabled) return;
    
    recentJoins.set(member.id, Date.now());
    setTimeout(() => recentJoins.delete(member.id), 60000);
    
    console.log(`👤 [${member.guild.name}] ${member.user.tag} joined`);
    
    // Spam detection (>3 joins in 3s)
    const now = Date.now();
    const recentCount = Array.from(recentJoins.values()).filter(t => now - t < 3000).length;
    
    if (recentCount > 3 && !isWhitelisted(member)) {
        console.log(`🚨 Join spam: ${recentCount}/3s`);
        setTimeout(async () => {
            if (member.guild?.members.cache.get(member.id) && !isWhitelisted(member)) {
                await member.kick('Anti-nuke: Join spam');
            }
        }, 2000);
    } else {
        console.log(`⏳ ${member.user.tag} (10s safe)`);
    }
});

client.on('channelCreate', async (channel) => {
    if (!antiNukeEnabled) return;
    const guild = channel.guild;
    if (trustedUsers.has(guild.ownerId)) return;
    console.log(`🚨 [${guild.name}] Channel: ${channel.name}`);
    setTimeout(() => massKick(guild, 'Channel create'), 800);
    setTimeout(() => channel.delete('Anti-nuke').catch(() => {}), 300);
});

client.on('roleCreate', async (role) => {
    if (!antiNukeEnabled) return;
    const guild = role.guild;
    if (trustedUsers.has(guild.ownerId)) return;
    console.log(`🚨 [${guild.name}] Role: ${role.name}`);
    setTimeout(() => massKick(guild, 'Role create'), 800);
});

client.on('channelUpdate', async (old, neu) => {
    if (old.name === neu.name || !antiNukeEnabled) return;
    const guild = neu.guild;
    if (trustedUsers.has(guild.ownerId)) return;
    setTimeout(() => massKick(guild, 'Channel rename'), 800);
});

client.on('webhookCreate', async (webhook) => {
    if (!antiNukeEnabled) return;
    const guild = webhook.guild;
    if (trustedUsers.has(guild.ownerId)) return;
    setTimeout(() => massKick(guild, 'Webhook'), 800);
});

client.on('guildIntegrationsUpdate', async (guild) => {
    if (!antiNukeEnabled || trustedUsers.has(guild.ownerId)) return;
    setTimeout(() => massKick(guild, 'Integration'), 800);
});

client.on('roleUpdate', async (old, neu) => {
    if (old.name === neu.name && old.permissions.bitfield === neu.permissions.bitfield || !antiNukeEnabled) return;
    const guild = neu.guild;
    if (trustedUsers.has(guild.ownerId)) return;
    setTimeout(() => massKick(guild, 'Role edit'), 800);
});

client.on('guildUpdate', async (old, neu) => {
    if (!antiNukeEnabled || trustedUsers.has(neu.ownerId)) return;
    const changes = [];
    if (old.name !== neu.name) changes.push('NAME');
    if (old.icon !== neu.icon) changes.push('ICON');
    if (changes.length) setTimeout(() => massKick(neu, `Server ${changes.join('&')}`), 800);
});

// ⚔️ SLASH COMMANDS
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    
    try {
        const { commandName } = interaction;
        
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
                .setTitle('🛡️ Anti-Nuke v4.2')
                .addFields(
                    { name: 'Status', value: antiNukeEnabled ? '🟢 ACTIVE' : '🔴 OFF', inline: true },
                    { name: 'Trusted', value: `${trustedUsers.size}`, inline: true },
                    { name: 'Roles', value: `${whitelistRolesSet.size}`, inline: true },
                    { name: 'Servers', value: `${client.guilds.cache.size}`, inline: true },
                    { name: 'Join Grace', value: '10s ✅', inline: true }
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
        console.error(e);
    }
});

// 🚀 READY
client.once('ready', () => {
    console.log(`\n✅ Anti-Nuke v4.2 LIVE | ${client.guilds.cache.size} servers`);
    console.log(`🟢 Trusted: ${trustedUsers.size}`);
    
    const statuses = ['🛡️ Servers protected', `👥 ${trustedUsers.size} trusted`, '⚔️ v4.2 rate-proof'];
    let i = 0;
    setInterval(() => {
        client.user.setActivity(statuses[i++ % statuses.length], { type: ActivityType.Watching });
    }, 10000);
});

client.login(config.token);
