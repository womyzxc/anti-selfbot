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

// 🚦 RATE LIMIT MANAGER
const rateLimits = new Map();
const processingGuilds = new Set();

// 🛡️ SMART WHITELIST CHECK
function isWhitelisted(member) {
    // Trusted users OR bot OR has whitelist role
    return trustedUsers.has(member.id) || 
           member.user.bot ||
           Array.from(whitelistRolesSet).some(roleId => member.roles.cache.has(roleId));
}

// 🕒 NEW JOIN PROTECTION (Smart - 10s grace period)
const recentJoins = new Map(); // userId -> joinTime
const joinGracePeriod = 10000; // 10 seconds safe period

function isSuspiciousJoin(member) {
    const joinTime = recentJoins.get(member.id);
    if (!joinTime) return false;
    
    const age = Date.now() - joinTime;
    return age > joinGracePeriod && !isWhitelisted(member);
}

// 🔥 SMART MASS KICK (Rate limit proof)
async function massKick(guild, reason) {
    const guildId = guild.id;
    if (!antiNukeEnabled || trustedUsers.has(guild.ownerId) || processingGuilds.has(guildId)) {
        return;
    }
    
    processingGuilds.add(guildId);
    console.log(`💥 [${guild.name}] Mass kick START (${reason})`);
    
    try {
        const members = await guild.members.fetch();
        let kicked = 0, protectedCount = 0, newJoinCount = 0;
        const queue = [];
        
        for (const member of members.values()) {
            if (isWhitelisted(member)) {
                protectedCount++;
                continue;
            }
            
            // Skip recent legit joins (within 10s)
            if (recentJoins.has(member.id) && (Date.now() - recentJoins.get(member.id)) < joinGracePeriod) {
                newJoinCount++;
                continue;
            }
            
            if (member.kickable) {
                queue.push(member);
            }
        }
        
        console.log(`📋 [${guild.name}] Queue: ${queue.length} | Protected: ${protectedCount} | New joins: ${newJoinCount}`);
        
        // Rate limited sequential kicks
        for (let i = 0; i < queue.length; i++) {
            const member = queue[i];
            
            // Rate limit check
            while (!canKick(guildId)) {
                const delay = rateLimits.get(guildId).nextKick - Date.now() + 100;
                await new Promise(r => setTimeout(r, delay));
            }
            
            try {
                await member.kick(`Anti-nuke: ${reason}`);
                kicked++;
                await logAction(guild, member, reason);
                
                // Rate limit update
                const nextKick = Date.now() + 60 + Math.random() * 20;
                rateLimits.set(guildId, { nextKick });
                
                console.log(`✅ [${guild.name}] ${kicked}/${queue.length} ${member.user.tag}`);
                
            } catch (e) {
                console.log(`⚠️ Skip ${member.user.tag}: ${e.message}`);
            }
            
            await new Promise(r => setTimeout(r, 65));
        }
        
        console.log(`🎉 [${guild.name}] COMPLETE: ${kicked}/${queue.length} kicked`);
        
    } catch (e) {
        console.error(`❌ Mass kick error:`, e.message);
    } finally {
        processingGuilds.delete(guildId);
        rateLimits.delete(guildId);
    }
}

function canKick(guildId) {
    const now = Date.now();
    const guildData = rateLimits.get(guildId);
    return !guildData || now >= guildData.nextKick;
}

// 🔥 JOIN EVENT - SMART PROTECTION
client.on('guildMemberAdd', async (member) => {
    if (!antiNukeEnabled) return;
    
    // Track join time
    recentJoins.set(member.id, Date.now());
    
    // Clean up old joins (keep last 60s)
    setTimeout(() => recentJoins.delete(member.id), 60000);
    
    console.log(`👤 [${member.guild.name}] ${member.user.tag} joined`);
    
    // IMMEDIATE CHECK: Selfbot/alt spam (multiple joins in 3s)
    const now = Date.now();
    const recentJoinCount = Array.from(recentJoins.values())
        .filter(time => now - time < 3000).length;
    
    if (recentJoinCount > 3) {
        console.log(`🚨 [${member.guild.name}] Join spam detected (${recentJoinCount}/3s)`);
        setTimeout(() => {
            if (!isWhitelisted(member) && member.guild?.members.cache.get(member.id)) {
                member.kick('Anti-nuke: Join spam');
                console.log(`🚨 Kicked spammer: ${member.user.tag}`);
            }
        }, 2000);
        return;
    }
    
    // SAFE: Legit users get 10s grace period
    console.log(`⏳ [${member.guild.name}] ${member.user.tag} (10s grace)`);
});

// 🔥 OTHER EVENTS (unchanged)
client.on('channelCreate', async (channel) => {
    if (!antiNukeEnabled) return;
    const guild = channel.guild;
    if (trustedUsers.has(guild.ownerId)) return;
    console.log(`🚨 [${guild.name}] Channel: ${channel.name}`);
    setTimeout(() => massKick(guild, 'Channel creation'), 800);
});

client.on('roleCreate', async (role) => {
    if (!antiNukeEnabled) return;
    const guild = role.guild;
    if (trustedUsers.has(guild.ownerId)) return;
    console.log(`🚨 [${guild.name}] Role: ${role.name}`);
    setTimeout(() => massKick(guild, 'Role creation'), 800);
});

// [Rest of events unchanged - channelUpdate, webhookCreate, etc...]
client.on('channelUpdate', async (oldChannel, newChannel) => {
    if (oldChannel.name === newChannel.name || !antiNukeEnabled) return;
    const guild = newChannel.guild;
    if (trustedUsers.has(guild.ownerId)) return;
    setTimeout(() => massKick(guild, 'Channel rename'), 800);
});

client.on('webhookCreate', async (webhook) => {
    if (!antiNukeEnabled) return;
    const guild = webhook.guild;
    if (trustedUsers.has(guild.ownerId)) return;
    setTimeout(() => massKick(guild, 'Webhook'), 800);
    setTimeout(() => webhook.delete('Anti-nuke').catch(() => {}), 300);
});

client.on('guildIntegrationsUpdate', async (guild) => {
    if (!antiNukeEnabled || trustedUsers.has(guild.ownerId)) return;
    setTimeout(() => massKick(guild, 'Integration'), 800);
});

client.on('roleUpdate', async (oldRole, newRole) => {
    if (oldRole.name === newRole.name && oldRole.permissions.bitfield === newRole.permissions.bitfield || !antiNukeEnabled) return;
    const guild = newRole.guild;
    if (trustedUsers.has(guild.ownerId)) return;
    setTimeout(() => massKick(guild, 'Role edit'), 800);
});

client.on('guildUpdate', async (oldGuild, newGuild) => {
    if (!antiNukeEnabled || trustedUsers.has(newGuild.ownerId)) return;
    const changes = [];
    if (oldGuild.name !== newGuild.name) changes.push('NAME');
    if (oldGuild.icon !== newGuild.icon) changes.push('ICON');
    if (changes.length) setTimeout(() => massKick(newGuild, `Server ${changes.join('&')}`), 800);
});

// 📊 SLASH COMMANDS (unchanged)
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    
    try {
        const { commandName } = interaction;
        
        if (commandName === 'antinode') {
            antiNukeEnabled = !antiNukeEnabled;
            await interaction.reply({ content: `🛡️ v4.2: **${antiNukeEnabled ? '🟢 ON' : '🔴 OFF'}**`, ephemeral: true });
        }
        
        if (commandName === 'add-trust') {
            const user = interaction.options.getUser('user');
            trustedUsers.add(user.id);
            await interaction.reply({ content: `✅ ${user.tag} trusted`, ephemeral: true });
        }
        
        if (commandName === 'status') {
            const embed = new EmbedBuilder()
                .setTitle('🛡️ Anti-Nuke v4.2')
                .addFields(
                    { name: 'Status', value: antiNukeEnabled ? '🟢 ACTIVE' : '🔴 PAUSED', inline: true },
                    { name: 'Trusted', value: `${trustedUsers.size}`, inline: true },
                    { name: 'Grace Period', value: '10s safe joins ✅', inline: true }
                )
                .setColor(antiNukeEnabled ? 0x00ff88 : 0xff4444);
            await interaction.reply({ embeds: [embed] });
        }
        
        if (commandName === 'masskick') {
            await interaction.reply({ content: '💥 Emergency kick started...', ephemeral: true });
            massKick(interaction.guild, 'Emergency');
        }
        
    } catch(e) {
        await interaction.reply({ content: '❌ Error', ephemeral: true }).catch(() => {});
    }
});

async function logAction(guild, member, reason) {
    try {
        if (config.logChannelId) {
            const channel = guild.channels.cache.get(config.logChannelId);
            if (channel) {
                await channel.send({ 
                    embeds: [{
                        title: '🚨 KICK',
                        description: `${member.user.tag}\n${reason}`,
                        color: 0xffaa00
                    }]
                });
            }
        }
    } catch(e) {}
}

// 🚀 START
client.once('ready', () => {
    console.log(`\n✅ Anti-Nuke v4.2 LIVE | Smart joins + Rate limits fixed`);
    client.user.setActivity(`🛡️ ${client.guilds.cache.size} servers`, { type: ActivityType.Watching });
});

client.login(config.token);
