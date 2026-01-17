require('dotenv').config();
const { Client, GatewayIntentBits, ActivityType, PermissionsBitField } = require('discord.js');

const config = {
    token: process.env.DISCORD_TOKEN,
    trustedIds: process.env.TRUSTED_IDS ? process.env.TRUSTED_IDS.split(',') : ['1184454687865438218'],
    authorizedCommandUsers: ['1184454687865438218'],
    kickDelayMs: parseInt(process.env.KICK_DELAY) || 8,      // 8ms ULTRA
    auditTimeoutMs: parseInt(process.env.AUDIT_TIMEOUT) || 120, // 120ms SELF-BOT SPEED
    threatWindowMs: parseInt(process.env.THREAT_WINDOW) || 250  // 250ms selfbot window
};

let antiNukeEnabled = true;
let trustedUsers = new Set(config.trustedIds);
let processingGuilds = new Set();
let threatScores = new Map(); // User threat scoring

console.log('🔥 ANTI-NUKE v6.4 - XEV SELF-BOT KILLER');
console.log('🎯 Analyzed: rainy/0x → INSTANT EXECUTOR KILL');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildBans,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildWebhooks,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildEmojisAndStickers
    ]
});

function isWhitelisted(member) {
    return trustedUsers.has(member.id) || 
           (member?.user?.bot && member.user.id !== member.guild.ownerId);
}

function addThreatScore(userId, guildId, points) {
    const key = `${guildId}:${userId}`;
    const score = (threatScores.get(key) || 0) + points;
    threatScores.set(key, score);
    console.log(`⚡ THREAT ${key}: ${score}pts (+${points})`);
    return score >= 2; // 2+ = EXECUTE
}

// ✅ SELF-BOT PATTERN DETECTOR (create_text_channel → rename → webhook)
async function getSelfbotExecutor(guild, actionType) {
    try {
        const auditLogs = await Promise.race([
            guild.fetchAuditLogs({ 
                limit: 10,  // 🎯 MORE LOGS = CATCHES MASS CREATE/RENAME
                type: actionType 
            }),
            new Promise((_, reject) => setTimeout(() => reject(), config.auditTimeoutMs))
        ]);
        
        // 🎯 MOST RECENT EXECUTOR IN 250ms WINDOW
        const recentEntry = auditLogs.entries
            .filter(e => Date.now() - e.createdTimestamp < config.threatWindowMs)
            .first();
            
        if (recentEntry) {
            const executorId = recentEntry.executor.id;
            if (!isWhitelisted({ id: executorId })) {
                console.log(`🎯 SELF-BOT HIT [${actionType}]: ${recentEntry.executor.tag}`);
                return executorId;
            }
        }
    } catch (e) {}
    return null;
}

async function instaKill(userId, guild, reason) {
    const member = guild.members.cache.get(userId);
    if (!member?.kickable || isWhitelisted(member)) {
        console.log(`⏭️ WHITELISTED: ${member?.user.tag}`);
        return false;
    }
    
    try {
        await member.kick(`ANTI-NUKE-v6.4|${reason}`);
        console.log(`💀 SELF-BOT KILLED: ${member.user.tag} (${reason})`);
        threatScores.delete(`${guild.id}:${userId}`);
        return true;
    } catch (e) {
        console.log(`❌ KICK FAIL: ${e.message.slice(0,25)}`);
        return false;
    }
}

// 🔥 RAINY/0x MASS CREATE DETECTOR
client.on('channelCreate', async (channel) => {
    if (!antiNukeEnabled) return;
    
    console.log(`🚨 CHANNEL CREATE [${Date.now()}] ${channel.name}`);
    
    const executorId = await getSelfbotExecutor(channel.guild, 'CHANNEL_CREATE');
    if (executorId && addThreatScore(executorId, channel.guild.id, 3)) {
        await instaKill(executorId, channel.guild, 'RAINY_CREATE');
        channel.delete('ANTI-NUKE').catch(() => {});
    }
});

// 🔥 RENAME DETECTOR (rainy/0x rename_channels())
client.on('channelUpdate', async (oldChannel, newChannel) => {
    if (oldChannel.name === newChannel.name) return;
    if (!antiNukeEnabled) return;
    
    console.log(`🚨 RENAME [${Date.now()}] "${oldChannel.name}" → "${newChannel.name}"`);
    
    const executorId = await getSelfbotExecutor(newChannel.guild, 'CHANNEL_UPDATE');
    if (executorId && addThreatScore(executorId, newChannel.guild.id, 2)) {
        await instaKill(executorId, newChannel.guild, 'SELF-BOT_RENAME');
        // AUTO-REVERT
        newChannel.setName(oldChannel.name, 'ANTI-NUKE').catch(() => {});
        return;
    }
});

// 🔥 WEBHOOK DETECTOR (create_and_spam_webhook())
client.on('webhookCreate', async (webhook) => {
    if (!antiNukeEnabled) return;
    
    console.log(`🚨 WEBHOOK CREATE [${Date.now()}] ${webhook.name}`);
    
    const executorId = await getSelfbotExecutor(webhook.guild, 'WEBHOOK_CREATE');
    if (executorId && addThreatScore(executorId, webhook.guild.id, 4)) {  // Webhook = 4pts
        await instaKill(executorId, webhook.guild, 'XEV_WEBHOOK');
        webhook.delete('ANTI-NUKE').catch(() => {});
        return;
    }
});

// 🔥 BONUS: Role creates, bans, etc.
client.on('roleCreate', async (role) => {
    if (!antiNukeEnabled) return;
    const executorId = await getSelfbotExecutor(role.guild, 'ROLE_CREATE');
    if (executorId && addThreatScore(executorId, role.guild.id, 3)) {
        await instaKill(executorId, role.guild, 'ROLE_SPAM');
        role.delete('ANTI-NUKE').catch(() => {});
    }
});

// 🛠️ Commands
client.on('interactionCreate', async (interaction) => {
    if (interaction.commandName === 'antinode' && config.authorizedCommandUsers.includes(interaction.user.id)) {
        antiNukeEnabled = !antiNukeEnabled;
        await interaction.reply({ content: `🛡️ ${antiNukeEnabled ? 'ON' : 'OFF'}`, ephemeral: true });
    }
});

client.once('ready', () => {
    console.log(`✅ v6.4 LIVE - XEV/RAINY/0x KILLER DEPLOYED`);
    client.user.setActivity('🔥 SELF-BOT EXECUTOR HUNTER', { type: ActivityType.Watching });
});

client.login(config.token);
