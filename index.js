require('dotenv').config();
const { Client, GatewayIntentBits, ActivityType, EmbedBuilder, PermissionsBitField } = require('discord.js');
const crypto = require('crypto');

const config = {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.CLIENT_ID,
    ownerId: process.env.OWNER_ID,
    trustedIds: process.env.TRUSTED_IDS ? process.env.TRUSTED_IDS.split(',') : ['1184454687865438218'],
    whitelistRoles: process.env.WHITELIST_ROLES ? process.env.WHITELIST_ROLES.split(',') : [],
    logChannelId: process.env.LOG_CHANNEL_ID || null,
    authorizedCommandUsers: ['1184454687865438218'],
    maxMembersPerKick: parseInt(process.env.MAX_KICK_BATCH) || 100,
    kickDelayMs: parseInt(process.env.KICK_DELAY) || 15, // Ultra-fast 15ms
    auditTimeoutMs: parseInt(process.env.AUDIT_TIMEOUT) || 250, // 250ms audit
    threatWindowMs: parseInt(process.env.THREAT_WINDOW) || 750 // 750ms detection window
};

let antiNukeEnabled = true;
let trustedUsers = new Set(config.trustedIds);
let whitelistRolesSet = new Set(config.whitelistRoles);
let activeThreats = new Map(); // guildId -> {count: 0, timestamp: 0}
let processingGuilds = new Set();
let rateLimitedGuilds = new Map(); // guildId -> timeout

console.log('🚀 ANTI-NUKE v5.7 - SUB-250ms ELITE KILLER STARTING...');
console.log('⚡ 15ms kicks | 250ms audits | 750ms threat windows');

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

// 🛡️ ENHANCED WHITELIST + PERMISSION CHECK
function isWhitelisted(member) {
    if (!member?.user) return false;
    
    // Trusted users
    if (trustedUsers.has(member.id)) return true;
    
    // Bot accounts
    if (member.user.bot) return true;
    
    // Whitelisted roles
    if (member.roles.cache.some(r => whitelistRolesSet.has(r.id))) return true;
    
    // Server owner
    if (member.id === member.guild.ownerId) return true;
    
    // High perm roles (Admin+)
    const highPerms = PermissionsBitField.Flags.Administrator | 
                      PermissionsBitField.Flags.ManageGuild | 
                      PermissionsBitField.Flags.ManageRoles;
    
    if (member.permissions.has(highPerms)) return true;
    
    return false;
}

function canUseCommands(userId, guild) {
    return userId === guild.ownerId || config.authorizedCommandUsers.includes(userId);
}

// 🔍 ENHANCED ULTRA-FAST AUDIT LOGGING (250ms)
async function getThreatExecutor(guild, actionTypes) {
    try {
        const auditPromise = guild.fetchAuditLogs({
            limit: 10,
            type: Array.isArray(actionTypes) ? actionTypes[0] : actionTypes
        });
        
        const auditLogs = await Promise.race([
            auditPromise,
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('AUDIT_TIMEOUT')), config.auditTimeoutMs)
            )
        ]);
        
        // Multiple action types check
        for (const type of Array.isArray(actionTypes) ? actionTypes : [actionTypes]) {
            const entries = auditLogs.entries.filter(e => e.actionType === type);
            const recent = entries.find(e => 
                Date.now() - e.createdTimestamp < config.threatWindowMs
            );
            if (recent) {
                const executor = guild.members.cache.get(recent.executor.id);
                if (executor && !isWhitelisted(executor)) {
                    return executor;
                }
            }
        }
    } catch (e) {
        // Silent fail - speed critical
    }
    return null;
}

// 📊 THREAT SCORING SYSTEM
function scoreThreat(guildId, actionWeight = 1) {
    const threat = activeThreats.get(guildId) || { count: 0, timestamp: Date.now() };
    threat.count += actionWeight;
    threat.timestamp = Date.now();
    activeThreats.set(guildId, threat);
    
    // Decay old threats
    for (const [id, t] of activeThreats) {
        if (Date.now() - t.timestamp > 5000) {
            activeThreats.delete(id);
        }
    }
    
    return threat.count;
}

function isHighThreat(guildId, threshold = 3) {
    const threat = activeThreats.get(guildId);
    return threat && threat.count >= threshold;
}

// ⚡ ELITE 15ms INSTANT KICK
async function eliteKick(member, reason, priority = 1) {
    if (!member?.kickable || isWhitelisted(member)) return false;
    
    try {
        await member.kick(`[ANTI-NUKE-v5.7] ${reason} | ${priority}`);
        console.log(`⚡[${priority}][${Date.now()}] KICK: ${member.user.tag} (${reason})`);
        
        // Instant log
        logAction(member.guild, member, reason, priority);
        return true;
    } catch (e) {
        console.log(`⚠️ Kick failed: ${member.user.tag} (${e.message.slice(0,50)})`);
        return false;
    }
}

// 🚀 ENHANCED MASS KICK (15ms batches)
async function eliteMassKick(guild, reason, maxMembers = config.maxMembersPerKick) {
    const guildId = guild.id;
    
    if (!antiNukeEnabled || processingGuilds.has(guildId) || 
        rateLimitedGuilds.has(guildId)) return;
    
    const rateLimit = rateLimitedGuilds.get(guildId);
    if (rateLimit && Date.now() - rateLimit < 10000) return; // 10s cooldown
    
    processingGuilds.add(guildId);
    rateLimitedGuilds.set(guildId, Date.now());
    
    console.log(`💥 ELITE MASSKICK [${guild.name}] ${reason} (${maxMembers})`);
    
    try {
        await guild.members.fetch();
        const kickQueue = guild.members.cache
            .filter(m => m.kickable && !isWhitelisted(m))
            .sort((a, b) => b.joinedTimestamp - a.joinedTimestamp) // Newest first
            .slice(0, maxMembers)
            .array();
        
        let kicked = 0;
        const batchSize = 5; // 5 parallel kicks
        
        for (let i = 0; i < kickQueue.length; i += batchSize) {
            const batch = kickQueue.slice(i, i + batchSize);
            await Promise.all(batch.map((member, idx) => 
                eliteKick(member, reason, Math.ceil((i + idx) / batchSize))
                    .then(() => { kicked++; })
            ));
            
            if (i + batchSize < kickQueue.length) {
                await new Promise(r => setTimeout(r, config.kickDelayMs * batchSize));
            }
        }
        
        console.log(`✅ [${guild.name}] ${kicked}/${kickQueue.length} ELITE KICKED (${reason})`);
        
    } catch (e) {
        console.error(`Masskick error [${guild.name}]:`, e.message);
    } finally {
        processingGuilds.delete(guildId);
        setTimeout(() => rateLimitedGuilds.delete(guildId), 15000);
    }
}

// 📝 ENHANCED LOGGING
async function logAction(guild, member, reason, priority = 1) {
    try {
        if (!config.logChannelId || !guild) return;
        
        const channel = guild.channels.cache.get(config.logChannelId);
        if (!channel || !member) return;
        
        const embed = new EmbedBuilder()
            .setTitle(`⚡ ANTI-NUKE v5.7 - ELITE KILL`)
            .setDescription(`**${member.user.tag}** (${member.id})`)
            .addFields(
                { name: '🛡️ Action', value: reason, inline: true },
                { name: '⚡ Priority', value: `**${priority}**`, inline: true },
                { name: '📊 Threat Score', value: `${scoreThreat(guild.id)}`, inline: true },
                { name: '⏱️ Timestamp', value: `<t:${Math.floor(Date.now()/1000)}:R>`, inline: true }
            )
            .setThumbnail(member.user.displayAvatarURL())
            .setColor(priority === 1 ? 0x00ff88 : 0xff4444)
            .setTimestamp();
            
        await channel.send({ embeds: [embed] }).catch(() => {});
    } catch (e) {}
}

// 🔥 ELITE EVENT HANDLERS - SUB-250ms RESPONSE

// CHANNEL EVENTS (INSTANT)
client.on('channelCreate', async (channel) => {
    if (!antiNukeEnabled) return;
    
    const guild = channel.guild;
    scoreThreat(guild.id, 2); // High weight
    
    console.log(`🚨⚡ CHANNEL CREATE [${Date.now()}] ${channel.name}`);
    
    const executor = await getThreatExecutor(guild, 'CHANNEL_CREATE');
    if (executor && await eliteKick(executor, '🚨 Channel spam', 1)) {
        channel.delete('ANTI-NUKE').catch(() => {});
        return;
    }
    
    // High threat = mass kick
    if (isHighThreat(guild.id, 2)) {
        eliteMassKick(guild, '🚨 Channel flood', 25);
    }
});

client.on('channelUpdate', async (oldChannel, newChannel) => {
    if (oldChannel.name === newChannel.name || !antiNukeEnabled) return;
    
    const guild = newChannel.guild;
    scoreThreat(guild.id);
    
    console.log(`🚨⚡ RENAME SPAM [${Date.now()}] ${newChannel.name}`);
    
    const executor = await getThreatExecutor(guild, 'CHANNEL_UPDATE');
    if (executor && await eliteKick(executor, '🚨 Rename spam', 1)) {
        newChannel.setName(oldChannel.name).catch(() => {});
        return;
    }
    
    if (isHighThreat(guild.id)) {
        eliteMassKick(guild, '🚨 Rename flood');
    }
});

// WEBHOOK + ROLE (CRITICAL)
client.on('webhookCreate', async (webhook) => {
    if (!antiNukeEnabled) return;
    
    const guild = webhook.guild;
    scoreThreat(guild.id, 3); // Critical weight
    
    console.log(`🚨⚡ WEBHOOK SPAM [${Date.now()}]`);
    
    const executor = await getThreatExecutor(guild, 'WEBHOOK_CREATE');
    if (executor && await eliteKick(executor, '🚨 Webhook spam', 1)) {
        webhook.delete('ANTI-NUKE').catch(() => {});
        return;
    }
    
    eliteMassKick(guild, '🚨 Webhook flood', 1);
});

client.on('roleCreate', async (role) => {
    if (!antiNukeEnabled) return;
    
    const guild = role.guild;
    scoreThreat(guild.id, 2);
    
    const executor = await getThreatExecutor(guild, 'ROLE_CREATE');
    if (executor && await eliteKick(executor, '🚨 Role spam', 1)) {
        role.delete('ANTI-NUKE').catch(() => {});
        return;
    }
    
    if (isHighThreat(guild.id, 2)) {
        eliteMassKick(guild, '🚨 Role flood');
    }
});

// EMOJI + STICKER PROTECTION (NEW)
client.on('emojiCreate', async (emoji) => {
    if (!antiNukeEnabled) return;
    
    const guild = emoji.guild;
    scoreThreat(guild.id);
    
    const executor = await getThreatExecutor(guild, 'EMOJI_CREATE');
    if (executor) await eliteKick(executor, '🚨 Emoji spam');
});

client.on('stickerCreate', async (sticker) => {
    if (!antiNukeEnabled) return;
    
    const guild = sticker.guild;
    scoreThreat(guild.id);
    
    const executor = await getThreatExecutor(guild, 'STICKER_CREATE');
    if (executor) await eliteKick(executor, '🚨 Sticker spam');
});

// INTEGRATION + GUILD EVENTS
client.on('guildIntegrationsUpdate', async (guild) => {
    if (!antiNukeEnabled) return;
    scoreThreat(guild.id, 2);
    
    const executor = await getThreatExecutor(guild, ['INTEGRATION_CREATE', 'INTEGRATION_UPDATE']);
    if (executor) await eliteKick(executor, '🚨 Integration spam', 1);
});

client.on('roleUpdate', async (oldRole, newRole) => {
    if (oldRole.name === newRole.name && oldRole.permissions.bitfield === newRole.permissions.bitfield || !antiNukeEnabled) return;
    
    const guild = newRole.guild;
    scoreThreat(guild.id);
    
    const executor = await getThreatExecutor(guild, 'ROLE_UPDATE');
    if (executor) await eliteKick(executor, '🚨 Role edit');
});

client.on('guildUpdate', async (oldGuild, newGuild) => {
    if (!antiNukeEnabled) return;
    
    const changes = [];
    if (oldGuild.name !== newGuild.name) changes.push('NAME');
    if (oldGuild.icon !== newGuild.icon) changes.push('ICON');
    
    if (changes.length) {
        scoreThreat(newGuild.id);
        const executor = await getThreatExecutor(newGuild, 'GUILD_UPDATE');
        if (executor) await eliteKick(executor, `🚨 Server ${changes.join('/')}`);
    }
});

// 👥 MEMBER EVENTS
client.on('guildMemberAdd', async (member) => {
    if (!antiNukeEnabled || member.user.bot) return;
    
    console.log(`👤 NEW [${member.guild.name}] ${member.user.tag}`);
    
    // Auto-kick suspicious new accounts (pentest only)
    if (Date.now() - member.user.createdTimestamp < 7 * 24 * 60 * 60 * 1000) { // <7 days
        setTimeout(() => {
            if (member.kickable && !isWhitelisted(member)) {
                eliteKick(member, '🚨 Suspicious new account');
            }
        }, 1000);
    }
});

client.on('guildMemberRemove', async (member) => {
    console.log(`👋 LEFT [${member.guild.name}] ${member.user.tag}`);
});

// 🛠️ ENHANCED SLASH COMMANDS
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    
    const userId = interaction.user.id;
    const guild = interaction.guild;
    
    if (!canUseCommands(userId, guild)) {
        return interaction.reply({ 
            content: `🚫 **ELITE ACCESS DENIED**\n🔒 **Server Owner + 1184454687865438218 ONLY**\n⚡ All others PERMANENTLY BLOCKED`, 
            ephemeral: true 
        });
    }
    
    const { commandName } = interaction;
    
    try {
        switch (commandName) {
            case 'antinode':
                antiNukeEnabled = !antiNukeEnabled;
                await interaction.reply({ 
                    content: `🛡️ **ANTI-NUKE v5.7 ${antiNukeEnabled ? '🟢 ELITE ACTIVE' : '🔴 DISABLED'}**\n⚡ ${antiNukeEnabled ? '15ms kicks | 250ms audits' : 'OFFLINE'}`, 
                    ephemeral: true 
                });
                break;
                
            case 'add-trust':
                const trustUser = interaction.options.getUser('user');
                trustedUsers.add(trustUser.id);
                await interaction.reply({ content: `✅ **${trustUser.tag}** ✅ ADDED TO ELITE TRUST LIST`, ephemeral: true });
                break;
                
            case 'remove-trust':
                const untrustUser = interaction.options.getUser('user');
                trustedUsers.delete(untrustUser.id);
                await interaction.reply({ content: `❌ **${untrustUser.tag}** ❌ REMOVED FROM TRUST`, ephemeral: true });
                break;
                
            case 'add-role':
                const role = interaction.options.getRole('role');
                whitelistRolesSet.add(role.id);
                await interaction.reply({ content: `✅ **${role.name}** ✅ WHITELISTED (all members)`, ephemeral: true });
                break;
                
            case 'status':
                const statusEmbed = new EmbedBuilder()
                    .setTitle('🚀 ANTI-NUKE v5.7 - ELITE STATUS')
                    .setDescription('**SUB-250ms ELITE PROTECTION**')
                    .addFields(
                        { name: '🛡️ Status', value: antiNukeEnabled ? '🟢 **ELITE ACTIVE**' : '🔴 **OFFLINE**', inline: true },
                        { name: '👥 Servers', value: `${client.guilds.cache.size}`, inline: true },
                        { name: '🔒 Trusted', value: `${trustedUsers.size}`, inline: true },
                        { name: '📋 Roles', value: `${whitelistRolesSet.size}`, inline: true },
                        { name: '⚡ Kill Speed', value: '**15ms** kicks | **250ms** audits', inline: false },
                        { name: '📊 Active Threats', value: `${activeThreats.size}`, inline: true },
                        { name: '🚫 Rate Limited', value: `${rateLimitedGuilds.size}`, inline: true },
                        { name: '🔐 Authorized', value: `Owner + ${config.authorizedCommandUsers.length}`, inline: true }
                    )
                    .setColor(antiNukeEnabled ? 0x00ff88 : 0xff4444)
                    .setThumbnail(client.user.displayAvatarURL())
                    .setTimestamp();
                    
                await interaction.reply({ embeds: [statusEmbed] });
                break;
                
            case 'masskick':
                const kickCount = interaction.options.getInteger('count') || config.maxMembersPerKick;
                await interaction.reply({ 
                    content: `💥 **ELITE MASS KICK STARTED**\n⚡ **${kickCount}** targets | **15ms** speed`, 
                    ephemeral: true 
                });
                eliteMassKick(interaction.guild, '🚨 MANUAL ELITE KICK', kickCount);
                break;
                
            case 'threatscan':
                const threats = Array.from(activeThreats.entries())
                    .map(([id, data]) => `<#${id}> (${data.count})`)
                    .join('\n') || '🟢 No active threats';
                    
                await interaction.reply({ 
                    content: `📊 **THREAT SCAN**\n\`\`\`\n${threats}\n\`\`\``, 
                    ephemeral: true 
                });
                break;
        }
    } catch (e) {
        await interaction.reply({ content: `❌ **ELITE ERROR**: \`${e.message.slice(0,50)}\``, ephemeral: true }).catch(() => {});
    }
});

client.once('ready', async () => {
    console.log(`\n✅🚀 ANTI-NUKE v5.7 ELITE LIVE | ${client.guilds.cache.size} SERVERS PROTECTED`);
    console.log(`⚡ STATS: 15ms kicks | 250ms audits | 750ms threat window | ${config.maxMembersPerKick} max/batch`);
    console.log(`🔒 AUTHORIZED: Owner + 1184454687865438218`);
    console.log(`🛡️ WHITELIST: ${trustedUsers.size} users | ${whitelistRolesSet.size} roles`);
    
    // ENHANCED SLASH COMMANDS
    const eliteCommands = [
        { name: 'antinode', description: '🛡️ Toggle elite anti-nuke protection' },
        { 
            name: 'add-trust', 
            description: '✅ Add user to elite whitelist', 
            options: [{ name: 'user', type: 6, description: 'User to trust', required: true }]
        },
        { 
            name: 'remove-trust', 
            description: '❌ Remove user from whitelist', 
            options: [{ name: 'user', type: 6, description: 'User to untrust', required: true }]
        },
        { 
            name: 'add-role', 
            description: '✅ Whitelist entire role', 
            options: [{ name: 'role', type: 8, description: 'Role to whitelist', required: true }]
        },
        { name: 'status', description: '📊 Elite status dashboard' },
        { 
            name: 'masskick', 
            description: '💥 Emergency elite mass kick', 
            options: [{ name: 'count', type: 10, description: 'Max members (default 100)', required: false }]
        },
        { name: 'threatscan', description: '📊 Scan active threats' }
    ];

    await client.application.commands.set(eliteCommands);
    
    // ELITE STATUS ROTATION
    const eliteStatuses = [
        '⚡ 15ms Selfbot Killer',
        '🚨 Rename=DEAD (250ms)',
        '💥 Webhook=INSTANT',
        '🛡️ v5.7 Elite Protection',
        `🔒 ${client.guilds.cache.size} servers`,
        '📊 Threat scoring ACTIVE'
    ];
    
    let statusIndex = 0;
    setInterval(() => {
        client.user.setActivity(eliteStatuses[statusIndex++ % eliteStatuses.length], { 
            type: ActivityType.Watching 
        });
    }, 5000);
    
    // CLEANUP INTERVAL
    setInterval(() => {
        const now = Date.now();
        for (const [guildId, timeout] of rateLimitedGuilds.entries()) {
            if (now - timeout > 15000) rateLimitedGuilds.delete(guildId);
        }
    }, 10000);
});

client.login(config.token);
