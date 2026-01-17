require('dotenv').config();
const { Client, GatewayIntentBits, ActivityType, PermissionsBitField } = require('discord.js');

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
let renamedChannels = new Map(); // ✅ NEW: Track renamed channels

console.log('🔥 ANTI-NUKE v6.2 - AUTO-REVERT FIXED');
console.log('⚡ 10ms kicks | 200ms audits | RENAME → KICK + REVERT');

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
            guild.fetchAuditLogs({ limit: 1, type: 'WEBHOOK_CREATE' }),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('TIMEOUT')), config.auditTimeoutMs)
            )
        ]);
        
        const webhookEntry = auditLogs.entries.first();
        if (webhookEntry && Date.now() - webhookEntry.createdTimestamp < config.threatWindowMs) {
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
            guild.fetchAuditLogs({ limit: 1, type: 'CHANNEL_UPDATE' }),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('TIMEOUT')), config.auditTimeoutMs)
            )
        ]);
        
        const renameEntry = auditLogs.entries.first();
        if (renameEntry && Date.now() - renameEntry.createdTimestamp < config.threatWindowMs &&
            renameEntry.changes.some(change => change.key === 'name')) {
            
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
        await member.kick(`ANTI-NUKE-v6.2|${reason}`);
        console.log(`⚡ KICK ${Date.now()}: ${member.user.tag} (${reason})`);
        return true;
    } catch (e) {
        console.log(`❌ KICK FAIL ${member.user.tag}: ${e.message.slice(0,30)}`);
        return false;
    }
}

async function revertChannelName(channel, originalName) {
    try {
        await channel.setName(originalName, 'ANTI-NUKE AUTO-REVERT');
        console.log(`🔄 REVERTED ${channel.name} → ${originalName}`);
        return true;
    } catch (e) {
        console.log(`❌ REVERT FAIL ${channel.name}: ${e.message.slice(0,30)}`);
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

// 🔥 FIXED CHANNEL RENAME + AUTO-REVERT
client.on('channelUpdate', async (oldChannel, newChannel) => {
    if (oldChannel.name === newChannel.name) return;
    if (!antiNukeEnabled) return;
    
    console.log(`🚨 RENAME DETECTED [${Date.now()}]`);
    console.log(`📝 OLD: "${oldChannel.name}" → NEW: "${newChannel.name}"`);
    
    // ✅ STEP 1: IMMEDIATE EXECUTOR KICK
    const executor = await getChannelRenamerExecutor(newChannel.guild);
    if (executor && await eliteKick(executor, 'CHANNEL_RENAME')) {
        console.log(`✅ KICKED + STORING FOR REVERT: ${newChannel.id}`);
        
        // ✅ STEP 2: STORE FOR AUTO-REVERT
        renamedChannels.set(newChannel.id, {
            originalName: oldChannel.name,
            timestamp: Date.now()
        });
        
        // ✅ STEP 3: FORCE REVERT WITH RETRY
        setTimeout(async () => {
            const revertData = renamedChannels.get(newChannel.id);
            if (revertData) {
                await revertChannelName(newChannel, revertData.originalName);
                renamedChannels.delete(newChannel.id); // ✅ CLEANUP
            }
        }, 100); // 100ms delay for stability
        
        return;
    }
    
    // FAILSAFE
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
        
        const entry = auditLogs.entries.first();
        if (entry && Date.now() - entry.createdTimestamp < config.threatWindowMs) {
            return guild.members.cache.get(entry.executor.id);
        }
    } catch (e) {}
    return null;
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
    console.log(`✅ v6.2 LIVE - AUTO-REVERT ENABLED`);
    
    client.application.commands.set([
        { name: 'antinode', description: 'Toggle anti-nuke' }
    ]);
    
    client.user.setActivity('🔥 v6.2 RENAME KILLER', { type: ActivityType.Watching });
});

client.login(config.token);
