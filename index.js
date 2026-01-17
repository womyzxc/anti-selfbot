require('dotenv').config();
const { Client, GatewayIntentBits, ActivityType, PermissionsBitField } = require('discord.js');

const config = {
    token: process.env.DISCORD_TOKEN,
    trustedIds: process.env.TRUSTED_IDS ? process.env.TRUSTED_IDS.split(',') : ['1184454687865438218'],
    authorizedCommandUsers: ['1184454687865438218'],
    kickDelayMs: parseInt(process.env.KICK_DELAY) || 8,      
    auditTimeoutMs: parseInt(process.env.AUDIT_TIMEOUT) || 120,
    threatWindowMs: 1000  
};

let antiNukeEnabled = true;
let trustedUsers = new Set(config.trustedIds);
let processingGuilds = new Set();
let threatScores = new Map();

console.log('OfficialX Anti Nuke Bot Security');
console.log('🎯 Analyzed: nuke → INSTANT EXECUTOR KILL');

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

let channelCreationTimes = new Map();
let webhookCreationTimes = new Map();
let lastWebhookSent = new Map();

function isWhitelisted(member) {
    return trustedUsers.has(member.id) || 
           (member?.user?.bot && member.user.id !== member.guild.ownerId);
}

function addThreatScore(userId, guildId, points) {
    const key = `${guildId}:${userId}`;
    const score = (threatScores.get(key) || 0) + points;
    threatScores.set(key, score);
    console.log(`⚡ THREAT ${key}: ${score}pts (+${points})`);
    return score >= 2; 
}

async function getSelfbotExecutor(guild, actionType) {
    try {
        const auditLogs = await Promise.race([
            guild.fetchAuditLogs({ 
                limit: 1,
                type: actionType 
            }),
            new Promise((_, reject) => setTimeout(() => reject(), config.auditTimeoutMs))
        ]);
        
        const recentEntries = auditLogs.entries
            .filter(e => Date.now() - e.createdTimestamp < config.threatWindowMs);

        if (recentEntries.length > 0) {
            const executorId = recentEntries[0].executor.id;
            return executorId;
        }
    } catch (e) {
        console.error(`[ERROR] Executor detection failed: ${e.message}`);
    }
    return null;
}

async function instaKill(userId, guild, reason) {
    const member = guild.members.cache.get(userId);
    if (!member?.kickable || isWhitelisted(member)) {
        console.log(`⏭️ WHITELISTED: ${member?.user.tag}`);
        return false;
    }

    if (!guild.me.permissions.has(PermissionsBitField.Flags.KickMembers)) {
        console.log(`❌ Bot does not have kick permissions in ${guild.name}`);
        return false;
    }

    try {
        await member.kick(`OfficialX|${reason}`);
        console.log(`💀 SELF-BOT KILLED: ${member.user.tag} (${reason})`);
        threatScores.delete(`${guild.id}:${userId}`);
        return true;
    } catch (e) {
        console.log(`❌ KICK FAIL: ${e.message.slice(0, 25)}`);
        return false;
    }
}

client.on('channelCreate', async (channel) => {
    if (!antiNukeEnabled) return;

    const currentTime = Date.now();
    let creationTimes = channelCreationTimes.get(channel.guild.id) || [];
    creationTimes.push(currentTime);
    channelCreationTimes.set(channel.guild.id, creationTimes);

    creationTimes = creationTimes.filter(time => currentTime - time < 1000);

    if (creationTimes.length > 0) {
        console.log(`🚨 CHANNEL CREATION DETECTED: ${channel.guild.name}`);
        const executorId = await getSelfbotExecutor(channel.guild, 'CHANNEL_CREATE');
        if (executorId) {
            await instaKill(executorId, channel.guild, 'CHANNEL_CREATE');
            channel.delete('ANTI-NUKE').catch(() => {});
        }
    }
});

client.on('webhookCreate', async (webhook) => {
    if (!antiNukeEnabled) return;

    const currentTime = Date.now();
    let creationTimes = webhookCreationTimes.get(webhook.guild.id) || [];
    creationTimes.push(currentTime);
    webhookCreationTimes.set(webhook.guild.id, creationTimes);

    creationTimes = creationTimes.filter(time => currentTime - time < 1000);

    if (creationTimes.length > 0) {
        console.log(`🚨 WEBHOOK CREATION DETECTED: ${webhook.guild.name}`);
        const executorId = await getSelfbotExecutor(webhook.guild, 'WEBHOOK_CREATE');
        if (executorId) {
            await instaKill(executorId, webhook.guild, 'WEBHOOK_CREATE');
            webhook.delete('ANTI-NUKE').catch(() => {});
        }
    }
});

async function sendWebhookMessage(session, url, headers, payload) {
    try {
        const currentTime = Date.now();
        if (lastWebhookSent.has(url) && currentTime - lastWebhookSent.get(url) < 1000) {
            console.log(`${Fore.RED}[!] Rate limited. Skipping this webhook.`);
            return;
        }

        const resp = await session.post(url, { json: payload, headers });
        if (resp.status === 204) {
            console.log(`${Fore.WHITE}[+] Webhook message sent.`);
            lastWebhookSent.set(url, Date.now());
        } else {
            console.log(`${Fore.YELLOW}[!] Webhook error: ${resp.status}`);
        }
    } catch (e) {
        console.error(`${Fore.RED}[!] Webhook send error: ${e}`);
    }
}

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
