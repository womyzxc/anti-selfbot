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
    kickDelayMs: parseInt(process.env.KICK_DELAY) || 10,  // 10ms ultra
    auditTimeoutMs: parseInt(process.env.AUDIT_TIMEOUT) || 200, // 200ms
    threatWindowMs: parseInt(process.env.THREAT_WINDOW) || 500  // 500ms
};

let antiNukeEnabled = true;
let trustedUsers = new Set(config.trustedIds);
let whitelistRolesSet = new Set(config.whitelistRoles);
let activeThreats = new Map();
let processingGuilds = new Set();
let rateLimitedGuilds = new Map();

console.log('🔥 ANTI-NUKE v6.0 - WEBHOOK/RENAME KILLER FIXED');
console.log('⚡ 10ms kicks | 200ms audits | RENAMES/WEBHOOKS = DEAD');

const client = Client({
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

// FIXED WHITELIST - NO FALSE POSITIVES
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

// 🔥 FIXED ULTRA-FAST AUDIT - WEBHOOK/CHANNEL SPECIALIZED
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
                console.log(`🎯 WEBHOOK EXECUTOR FOUND: ${executor.user.tag}`);
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
                console.log(`🎯 RENAMER EXECUTOR FOUND: ${executor.user.tag}`);
                return executor;
            }
        }
    } catch (e) {}
    return null;
}

// ⚡ FIXED 10ms ELITE KICK
async function eliteKick(member, reason) {
    if (!member?.kickable || isWhitelisted(member)) {
        console.log(`⏭️ SKIP ${member?.user.tag || 'NULL'} (whitelisted)`);
        return false;
    }
    
    try {
        await member.kick(`ANTI-NUKE-v6.0|${reason}`);
        console.log(`⚡ KICK ${Date.now()}: ${member.user.tag} (${reason})`);
        return true;
    } catch (e) {
        console.log(`❌ KICK FAIL ${member.user.tag}: ${e.message.slice(0,30)}`);
        return false;
    }
}

// 🔥 FIXED WEBHOOK HANDLER - IMMEDIATE KILL
client.on('webhookCreate', async (webhook) => {
    if (!antiNukeEnabled) return;
    
    console.log(`🚨 WEBHOOK SPAM DETECTED [${Date.now()}]`);
    
    // IMMEDIATE AUDIT + KILL
    const executor = await getWebhookRenamerExecutor(webhook.guild);
    if (executor && await eliteKick(executor, 'WEBHOOK_SPAM')) {
        webhook.delete('ANTI-NUKE').catch(() => {});
        return;
    }
    
    // FAILSAFE MASS KICK
    setTimeout(() => eliteMassKick(webhook.guild, 'WEBHOOK_FAILSAFE'), 50);
});

// 🔥 FIXED CHANNEL RENAME HANDLER - NAME CHANGE DETECTION
client.on('channelUpdate', async (oldChannel, newChannel) => {
    // FIXED: Only trigger on actual name changes
    if (oldChannel.name === newChannel.name) return;
    if (!antiNukeEnabled) return;
    
    console.log(`🚨 RENAME DETECTED [${Date.now()}] ${oldChannel.name} → ${newChannel.name}`);
    
    // IMMEDIATE AUDIT + KILL
    const executor = await getChannelRenamerExecutor(newChannel.guild);
    if (executor && await eliteKick(executor, 'CHANNEL_RENAME')) {
        // REVERT NAME
        newChannel.setName(oldChannel.name).catch(() => {});
        return;
    }
    
    // FAILSAFE
    setTimeout(() => eliteMassKick(newChannel.guild, 'RENAME_FAILSAFE'), 50);
});

// 🛡️ ALL OTHER EVENTS (unchanged but fixed)
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

// 🔧 FIXED MASS KICK
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

// FIXED getThreatExecutor (backup)
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

// 🛠️ COMMANDS (unchanged)
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
    console.log(`✅ v6.0 LIVE - WEBHOOK/RENAME FIXED`);
    
    client.application.commands.set([
        { name: 'antinode', description: 'Toggle' }
    ]);
    
    client.user.setActivity('🔥 WEBHOOK/RENAME KILLER', { type: ActivityType.Watching });
});

client.login(config.token);
