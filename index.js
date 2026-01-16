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

console.log('🤖 Starting Anti-Nuke v4.0...');
console.log('👥 Initial trusted:', Array.from(trustedUsers).join(', '));
console.log('🎭 Initial roles:', Array.from(whitelistRolesSet).join(', '));

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

// 🛡️ Whitelist Check
function isWhitelisted(member) {
    return trustedUsers.has(member.id) || 
           Array.from(whitelistRolesSet).some(roleId => member.roles.cache.has(roleId)) ||
           member.user.bot;
}

// 🔥 PROTECTION EVENTS
client.on('guildUpdate', async (oldGuild, newGuild) => {
    if (!antiNukeEnabled || trustedUsers.has(newGuild.ownerId)) return;
    const changes = [];
    if (oldGuild.name !== newGuild.name) changes.push('NAME');
    if (oldGuild.icon !== newGuild.icon) changes.push('ICON');
    if (oldGuild.banner !== newGuild.banner) changes.push('BANNER');
    if (changes.length) await massKick(newGuild, `Server ${changes.join('&')} modified`);
});

client.on('channelCreate', async (channel) => {
    if (!antiNukeEnabled) return;
    const guild = channel.guild;
    if (trustedUsers.has(guild.ownerId)) return;
    console.log(`🚨 [${guild.name}] Channel created: ${channel.name}`);
    await massKick(guild, 'Channel creation');
    setTimeout(() => channel.delete('Anti-nuke cleanup').catch(() => {}), 100);
});

client.on('channelUpdate', async (oldChannel, newChannel) => {
    if (oldChannel.name === newChannel.name || !antiNukeEnabled) return;
    const guild = newChannel.guild;
    if (trustedUsers.has(guild.ownerId)) return;
    console.log(`🚨 [${guild.name}] Channel renamed: ${oldChannel.name}`);
    await massKick(guild, 'Channel rename');
});

client.on('webhookCreate', async (webhook) => {
    if (!antiNukeEnabled) return;
    const guild = webhook.guild;
    if (trustedUsers.has(guild.ownerId)) return;
    console.log(`🚨 [${guild.name}] Webhook: ${webhook.name}`);
    await massKick(guild, 'Webhook creation');
    setTimeout(() => webhook.delete('Anti-nuke').catch(() => {}), 100);
});

client.on('guildMemberAdd', async (member) => {
    if (!antiNukeEnabled || isWhitelisted(member)) return;
    setTimeout(async () => {
        if (member.guild && member.kickable && !isWhitelisted(member)) {
            await member.kick('Anti-nuke: Suspicious join');
            console.log(`🚨 Kicked join: ${member.user.tag}`);
        }
    }, 100);
});

client.on('guildIntegrationsUpdate', async (guild) => {
    if (!antiNukeEnabled || trustedUsers.has(guild.ownerId)) return;
    console.log(`🚨 [${guild.name}] Integration added`);
    await massKick(guild, 'Bot/Integration addition');
});

client.on('roleCreate', async (role) => {
    if (!antiNukeEnabled) return;
    const guild = role.guild;
    if (trustedUsers.has(guild.ownerId)) return;
    console.log(`🚨 [${guild.name}] Role created: ${role.name}`);
    await massKick(guild, 'Role creation');
    setTimeout(() => role.delete('Anti-nuke').catch(() => {}), 100);
});

client.on('roleUpdate', async (oldRole, newRole) => {
    if (oldRole.name === newRole.name && oldRole.permissions.bitfield === newRole.permissions.bitfield || !antiNukeEnabled) return;
    const guild = newRole.guild;
    if (trustedUsers.has(guild.ownerId)) return;
    console.log(`🚨 [${guild.name}] Role modified: ${oldRole.name}`);
    await massKick(guild, 'Role modification');
});

// ⚔️ MASS KICK ENGINE
async function massKick(guild, reason) {
    try {
        const members = await guild.members.fetch();
        let kicked = 0, protectedCount = 0;
        
        for (const member of members.values()) {
            if (isWhitelisted(member)) {
                protectedCount++;
                continue;
            }
            
            const now = Date.now();
            const key = `${member.id}-${guild.id}`;
            if (!recentActions.has(key) || now - recentActions.get(key) > 3000) {
                try {
                    if (member.kickable) {
                        await member.kick(`Anti-nuke: ${reason}`);
                        recentActions.set(key, now);
                        kicked++;
                        await logAction(guild, member, reason);
                    }
                } catch (e) {
                    console.log(`⚠️ Skip ${member.user.tag}: ${e.message}`);
                }
            }
        }
        
        console.log(`💥 [${guild.name}] Mass kick: ${kicked} kicked, ${protectedCount} protected (${reason})`);
    } catch (e) {
        console.error('Mass kick error:', e);
    }
}

const recentActions = new Map();

// 📊 SLASH COMMANDS
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    
    try {
        const { commandName } = interaction;
        
        // /antinode
        if (commandName === 'antinode') {
            antiNukeEnabled = !antiNukeEnabled;
            await interaction.reply({ 
                content: `🛡️ Anti-nuke is now **${antiNukeEnabled ? '🟢 ONLINE' : '🔴 OFFLINE'}**`, 
                ephemeral: true 
            });
        }
        
        // /add-trust
        if (commandName === 'add-trust') {
            const user = interaction.options.getUser('user');
            trustedUsers.add(user.id);
            await interaction.reply({ content: `✅ **${user.tag}** added to trusted whitelist`, ephemeral: true });
            logAction(interaction.guild, null, `Trusted added: ${user.tag}`);
        }
        
        // /remove-trust
        if (commandName === 'remove-trust') {
            const user = interaction.options.getUser('user');
            trustedUsers.delete(user.id);
            await interaction.reply({ content: `❌ **${user.tag}** removed from trusted list`, ephemeral: true });
            logAction(interaction.guild, null, `Trusted removed: ${user.tag}`);
        }
        
        // /add-role
        if (commandName === 'add-role') {
            const role = interaction.options.getRole('role');
            whitelistRolesSet.add(role.id);
            await interaction.reply({ content: `✅ **${role.name}** added to role whitelist`, ephemeral: true });
            logAction(interaction.guild, null, `Role whitelisted: ${role.name}`);
        }
        
        // /remove-role
        if (commandName === 'remove-role') {
            const role = interaction.options.getRole('role');
            whitelistRolesSet.delete(role.id);
            await interaction.reply({ content: `❌ **${role.name}** removed from whitelist`, ephemeral: true });
            logAction(interaction.guild, null, `Role whitelist removed: ${role.name}`);
        }
        
        // /status
        if (commandName === 'status') {
            const embed = new EmbedBuilder()
                .setTitle('🛡️ Anti-Nuke v4.0 Status')
                .addFields(
                    { name: '🔒 Protection Status', value: antiNukeEnabled ? '🟢 **ACTIVE**' : '🔴 **PAUSED**', inline: true },
                    { name: '👥 Trusted Users', value: `${trustedUsers.size}`, inline: true },
                    { name: '🎭 Whitelist Roles', value: `${whitelistRolesSet.size}`, inline: true },
                    { name: '🏰 Servers Protected', value: `${client.guilds.cache.size}`, inline: true },
                    { name: '📊 Uptime', value: `${Math.round(client.uptime / 3600000)}h`, inline: true }
                )
                .setColor(antiNukeEnabled ? '#00ff88' : '#ff4444')
                .setFooter({ text: 'Railway hosted • Zero tolerance' })
                .setTimestamp();
            await interaction.reply({ embeds: [embed] });
        }
        
        // /list-trust
        if (commandName === 'list-trust') {
            const trusted = Array.from(trustedUsers).slice(0, 10);
            const roles = Array.from(whitelistRolesSet).slice(0, 10);
            const embed = new EmbedBuilder()
                .setTitle('📋 Whitelist')
                .addFields(
                    { name: '👥 Trusted Users', value: trusted.length ? trusted.join('\n') : 'None', inline: true },
                    { name: '🎭 Whitelist Roles', value: roles.length ? roles.join('\n') : 'None', inline: true }
                )
                .setColor('#00aa00');
            await interaction.reply({ embeds: [embed] });
        }
        
        // /masskick
        if (commandName === 'masskick') {
            await interaction.reply({ content: '💥 **EMERGENCY MASS KICK ACTIVATED** - Check logs', ephemeral: true });
            await massKick(interaction.guild, 'Emergency command');
        }
        
    } catch (error) {
        console.error(error);
        await interaction.reply({ content: '❌ Command error', ephemeral: true });
    }
});

// 📝 Logging
async function logAction(guild, member, reason) {
    try {
        if (config.logChannelId && guild) {
            const logChannel = guild.channels.cache.get(config.logChannelId);
            if (logChannel) {
                const embed = new EmbedBuilder()
                    .setTitle('🚨 ANTI-NUKE TRIGGERED')
                    .setDescription(`${member ? `**${member.user.tag}** (${member.id})` : 'Admin action'}\n**${reason}**`)
                    .setColor('#ff4444')
                    .setTimestamp();
                await logChannel.send({ embeds: [embed] });
            }
        }
        if (member) console.log(`KICK: ${member.user.tag} - ${reason}`);
    } catch (e) {}
}

// 🚀 STARTUP
client.once('ready', async () => {
    const guilds = client.guilds.cache.size;
    console.log(`\n✅ Anti-Nuke v4.0 LIVE | ${guilds} servers | Slash commands ready!`);
    console.log(`🟢 Protection: ${antiNukeEnabled ? 'ON' : 'OFF'}`);
    
    // Status rotation
    const statuses = [
        `🛡️ ${guilds} servers safe`,
        `👥 ${trustedUsers.size} trusted`,
        `🚨 Zero tolerance active`,
        `⚔️ /status for stats`
    ];
    let i = 0;
    setInterval(() => {
        client.user.setActivity(statuses[i++ % statuses.length], { type: ActivityType.Watching });
    }, 10000);
});

client.login(config.token);
