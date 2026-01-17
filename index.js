require('dotenv').config();
const { Client, GatewayIntentBits, ActivityType, PermissionsBitField } = require('discord.js');

const config = {
    token: process.env.DISCORD_TOKEN,
    trustedIds: process.env.TRUSTED_IDS ? process.env.TRUSTED_IDS.split(',') : ['1184454687865438218'],
    authorizedCommandUsers: ['1184454687865438218'],
    kickDelayMs: parseInt(process.env.KICK_DELAY) || 8,      // 8ms ULTRA
    auditTimeoutMs: parseInt(process.env.AUDIT_TIMEOUT) || 120, // 120ms SELF-BOT SPEED
    threatWindowMs: 1000  // 1000ms (1 second) threat window for rapid actions
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

    // Check if bot has permissions to kick
    if (!guild.me.permissions.has(PermissionsBitField.Flags.KickMembers)) {
        console.log(`❌ Bot does not have kick permissions in ${guild.name}`);
        return false;
    }

    try {
        await member.kick(`ANTI-NUKE-v6.4|${reason}`);
        console.log(`💀 SELF-BOT KILLED: ${member.user.tag} (${reason})`);
        threatScores.delete(`${guild.id}:${userId}`);
        return true;
    } catch (e) {
        console.log(`❌ KICK FAIL: ${e.message.slice(0, 25)}`);
        return false;
    }
}

// 🔥 RAINY/0x MASS CREATE DETECTOR
client.on('channelCreate', async (channel) => {
    if (!antiNukeEnabled) return;

    const currentTime = Date.now();
    let creationTimes = channelCreationTimes.get(channel.guild.id) || [];
    creationTimes.push(currentTime);
    channelCreationTimes.set(channel.guild.id, creationTimes);

    // Cleanup old creation times (older than 1 second)
    creationTimes = creationTimes.filter(time => currentTime - time < 1000);

    // Check for a single rapid creation of a channel (1 action within 1 second)
    if (creationTimes.length > 0) {
        console.log(`🚨 CHANNEL CREATION DETECTED: ${channel.guild.name}`);
        const executorId = await getSelfbotExecutor(channel.guild, 'CHANNEL_CREATE');
        if (executorId) {
            await instaKill(executorId, channel.guild, 'CHANNEL_CREATE');
            channel.delete('ANTI-NUKE').catch(() => {});
        }
    }
});

// 🔥 WEBHOOK DETECTOR (create_and_spam_webhook())
client.on('webhookCreate', async (webhook) => {
    if (!antiNukeEnabled) return;

    const currentTime = Date.now();
    let creationTimes = webhookCreationTimes.get(webhook.guild.id) || [];
    creationTimes.push(currentTime);
    webhookCreationTimes.set(webhook.guild.id, creationTimes);

    // Cleanup old creation times (older than 1 second)
    creationTimes = creationTimes.filter(time => currentTime - time < 1000);

    // Check for rapid creation of webhooks (e.g., 2+ webhooks in 1 second)
    if (creationTimes.length > 1) {
        console.log(`🚨 MASS WEBHOOK CREATION DETECTED: ${webhook.guild.name}`);

        // Check executor (the person who created the webhook)
        const executorId = await getSelfbotExecutor(webhook.guild, 'WEBHOOK_CREATE');
        if (executorId) {
            await instaKill(executorId, webhook.guild, 'WEBHOOK_CREATE');
            // Delete the webhook created
            webhook.delete('ANTI-NUKE').catch(() => {});
        }
    }
});

// ** Rate-Limited Webhook Spam **
async function sendWebhookMessage(session, url, headers, payload) {
    try {
        const currentTime = Date.now();
        if (lastWebhookSent.has(url) && currentTime - lastWebhookSent.get(url) < 1000) {  // Rate limit: 1 message per second
            console.log(`${Fore.RED}[!] Rate limited. Skipping this webhook.`);
            return;
        }

        const resp = await session.post(url, { json: payload, headers });
        if (resp.status === 204) {
            console.log(`${Fore.WHITE}[+] Webhook message sent.`);
            lastWebhookSent.set(url, Date.now());  // Update last sent time
        } else {
            console.log(`${Fore.YELLOW}[!] Webhook error: ${resp.status}`);
        }
    } catch (e) {
        console.error(`${Fore.RED}[!] Webhook send error: ${e}`);
    }
}

// 🛠️ Commands (Fixed)
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;

    // Make sure the user is authorized to use the command
    if (interaction.commandName === 'antinode' && config.authorizedCommandUsers.includes(interaction.user.id)) {
        antiNukeEnabled = !antiNukeEnabled;
        await interaction.reply({ content: `🛡️ Anti-Nuke is now ${antiNukeEnabled ? 'ON' : 'OFF'}`, ephemeral: true });
    }
});

client.once('ready', async () => {
    console.log(`✅ v6.4 LIVE - XEV/RAINY/0x KILLER DEPLOYED`);
    client.user.setActivity('🔥 SELF-BOT EXECUTOR HUNTER', { type: ActivityType.Watching });

    // Register the slash command for /antinode if it hasn't been registered
    const commands = await client.application.commands.set([
        {
            name: 'antinode',
            description: 'Toggle anti-nuke protection on/off.',
        },
    ]);
    console.log('Slash commands registered!');
});

client.login(config.token);
