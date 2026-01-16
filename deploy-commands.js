require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
    new SlashCommandBuilder().setName('antinode').setDescription('Toggle anti-nuke ON/OFF').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('add-trust').setDescription('Add trusted user').setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(o => o.setName('user').setDescription('User to trust').setRequired(true)),
    new SlashCommandBuilder().setName('remove-trust').setDescription('Remove trusted user').setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(o => o.setName('user').setDescription('User to untrust').setRequired(true)),
    new SlashCommandBuilder().setName('add-role').setDescription('Whitelist role').setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addRoleOption(o => o.setName('role').setDescription('Role to whitelist').setRequired(true)),
    new SlashCommandBuilder().setName('remove-role').setDescription('Remove whitelisted role').setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addRoleOption(o => o.setName('role').setDescription('Role to remove').setRequired(true)),
    new SlashCommandBuilder().setName('status').setDescription('Show anti-nuke status'),
    new SlashCommandBuilder().setName('list-trust').setDescription('List trusted users/roles'),
    new SlashCommandBuilder().setName('masskick').setDescription('Emergency mass kick').setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
];

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
        console.log('✅ Slash commands deployed!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Deploy failed:', error);
        process.exit(1);
    }
})();
