require('dotenv').config();
const { Client, GatewayIntentBits, ActivityType, EmbedBuilder, PermissionsBitField } = require('discord.js');

const config = {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.CLIENT_ID,
    ownerId: process.env.OWNER_ID,
    trustedIds: process.env.TRUSTED_IDS ? process.env.TRUSTED_IDS.split(',') : ['1184454687865438218'],
    whitelistRoles: process.env.WHITELIST_ROLES ? process.env.WHITELIST_ROLES.split(',') : [],
    logChannelId: process.env.LOG_CHANNEL_ID || null,
    authorizedCommandUsers: ['1184454687865438218'],
    maxMembersPerKick: parseInt(process.env.MAX_KICK_BATCH) || 100,
    kickDelayMs: parseInt(process.env.KICK_DELAY) || 10,
    auditTimeoutMs: parseInt(process.env.AUDIT_TIMEOUT) || 200,
    threatWindowMs: parseInt(process.env.THREAT_WINDOW) || 500
};

let antiNukeEnabled = true;
let trustedUsers = new Set(config.trustedIds);
let whitelistRolesSet = new Set(config.whitelistRoles);
let processingGuilds = new Set();

console.log('🔥 ANTI-NUKE v6.1 - FIXED & READY');
console.log('⚡ 10ms kicks | 200ms audits | WEBHOOK/RENAME KILLER');

const client = new Client({  // ✅ FIXED: Added 'new'
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildBans,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildWebhooks,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildIntegrations,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildEmojisAndStickers
    ]
});

function isWhitelisted(member) {
    if (!member?.user || !member.guild) return false;
    
    return trustedUsers.has(member.id) || 
           member.user.bot || 
           member.id === member.guild.ownerId ||
           member.roles.cache.some(r => whitelistRolesSet.has(r.id));
}

function canUseCommands(userId, guild) {
    return userId === guild.ownerId || config.authorizedCommandUsers.includes(userId);
}

async function getWebhookRenamerExecutor(guild) {
    try {
        const auditLogs = await Promise.race([
            guild.fetchAuditLogs({ 
                limit: 1, 
                type: 'WEBHOOK_CREATE' 
            }),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('TIMEOUT')), config.auditTimeoutMs)
            )
        ]);
        
        const webhookEntry = auditLogs.entries.find(entry => 
            Date.now() - entry.createdTimestamp < config.threatWindowMs
        );
        
        if (webhookEntry) {
            const executor = guild.members.cache.get(webhookEntry.executor.id);
            if (executor && !isWhitelisted(executor)) {
                console.log(`🎯 WEBHOOK EXECUTOR: ${executor.user.tag}`);
                return executor;
            }
        }
    } catch (e) {}
    return null;
}

async function getChannelRenamerExecutor(guild) {
    try {
        const auditLogs = await Promise.race([
            guild.fetchAuditLogs({ 
                limit: 1, 
                type: 'CHANNEL_UPDATE' 
            }),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('TIMEOUT')), config.auditTimeoutMs)
            )
        ]);
        
        const renameEntry = auditLogs.entries.find(entry => 
            Date.now() - entry.createdTimestamp < config.threatWindowMs &&
            entry.changes.some(change => change.key === 'name')
        );
        
        if (renameEntry) {
            const executor = guild.members.cache.get(renameEntry.executor.id);
            if (executor && !isWhitelisted(executor)) {
                console.log(`🎯 RENAMER EXECUTOR: ${executor.user.tag}`);
                return executor;
            }
        }
    } catch (e) {}
    return null;
}

async function eliteKick(member, reason) {
    if (!member?.kickable || isWhitelisted(member)) {
        console.log(`⏭️ SKIP ${member?.user.tag || 'NULL'}`);
        return false;
    }
    
    try {
        await member.kick(`ANTI-NUKE-v6.1|${reason}`);
        console.log(`⚡ KICK ${Date.now()}: ${member.user.tag} (${reason})`);
        return true;
    } catch (e) {
        console.log(`❌ KICK FAIL ${member.user.tag}: ${e.message.slice(0,30)}`);
        return false;
    }
}

async function eliteMassKick(guild, reason) {
    const guildId = guild.id;
    if (processingGuilds.has(guildId)) return;
    
    processingGuilds.add(guildId);
    console.log(`💥 MASSKICK ${guild.name} (${reason})`);
    
    try {
        const members = guild.members.cache.filter(m => 
            m.kickable && !isWhitelisted(m)
        );
        
        for (const member of members.first(50).values()) {
            await eliteKick(member, reason);
            await new Promise(r => setTimeout(r, config.kickDelayMs));
        }
    } finally {
        processingGuilds.delete(guildId);
    }
}

// 🔥 WEBHOOK HANDLER
client.on('webhookCreate', async (webhook) => {
    if (!antiNukeEnabled) return;
    
    console.log(`🚨 WEBHOOK SPAM [${Date.now()}]`);
    
    const executor = await getWebhookRenamerExecutor(webhook.guild);
    if (executor && await eliteKick(executor, 'WEBHOOK_SPAM')) {
        webhook.delete('ANTI-NUKE').catch(() => {});
        return;
    }
    
    setTimeout(() => eliteMassKick(webhook.guild, 'WEBHOOK_FAILSAFE'), 50);
});

// 🔥 CHANNEL RENAME HANDLER
client.on('channelUpdate', async (oldChannel, newChannel) => {
    if (oldChannel.name === newChannel.name) return;
    if (!antiNukeEnabled) return;
    
    console.log(`🚨 RENAME [${Date.now()}] ${oldChannel.name} → ${newChannel.name}`);
    
    const executor = await getChannelRenamerExecutor(newChannel.guild);
    if (executor && await eliteKick(executor, 'CHANNEL_RENAME')) {
        newChannel.setName(oldChannel.name).catch(() => {});
        return;
    }
    
    setTimeout(() => eliteMassKick(newChannel.guild, 'RENAME_FAILSAFE'), 50);
});

// 🛡️ OTHER EVENTS
client.on('channelCreate', async (channel) => {
    if (!antiNukeEnabled) return;
    console.log(`🚨 CHANNEL CREATE [${Date.now()}]`);
    
    const executor = await getThreatExecutor(channel.guild, 'CHANNEL_CREATE');
    if (executor && await eliteKick(executor, 'CHANNEL_CREATE')) {
        channel.delete('ANTI-NUKE').catch(() => {});
    }
});

client.on('roleCreate', async (role) => {
    if (!antiNukeEnabled) return;
    const executor = await getThreatExecutor(role.guild, 'ROLE_CREATE');
    if (executor && await eliteKick(executor, 'ROLE_CREATE')) {
        role.delete('ANTI-NUKE').catch(() => {});
    }
});

async function getThreatExecutor(guild, actionType) {
    try {
        const auditLogs = await Promise.race([
            guild.fetchAuditLogs({ type: actionType, limit: 5 }),
            new Promise((_, reject) => setTimeout(() => reject(), config.auditTimeoutMs))
        ]);
        
        const entry = auditLogs.entries.find(e => 
            Date.now() - e.createdTimestamp < config.threatWindowMs
        );
        
        return entry ? guild.members.cache.get(entry.executor.id) : null;
    } catch (e) {
        return null;
    }
}

// 🛠️ COMMANDS
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    
    if (!canUseCommands(interaction.user.id, interaction.guild)) {
        return interaction.reply({ content: '🚫 ACCESS DENIED', ephemeral: true });
    }
    
    if (interaction.commandName === 'antinode') {
        antiNukeEnabled = !antiNukeEnabled;
        await interaction.reply({ content: `🛡️ ${antiNukeEnabled ? 'ON' : 'OFF'}`, ephemeral: true });
    }
});

client.once('ready', () => {
    console.log(`✅ v6.1 LIVE - WEBHOOK/RENAME READY`);
    
    client.application.commands.set([
        { name: 'antinode', description: 'Toggle anti-nuke' }
    ]);
    
    client.user.setActivity('🔥 v6.1 WEBHOOK KILLER', { type: ActivityType.Watching });
});

client.login(config.token);
