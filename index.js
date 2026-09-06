import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  ModalBuilder,
  PermissionsBitField,
  REST,
  Routes,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';

const DATA_DIR = path.resolve('data');
const DB_FILE = path.join(DATA_DIR, 'store.json');
const TOKEN = process.env.DISCORD_TOKEN;

if (!TOKEN) {
  console.error('DISCORD_TOKEN não foi configurado. Copie .env.example para .env e preencha o token.');
  process.exit(1);
}

const defaultStore = {
  config: {
    description: 'Clique em Key grátis para liberar o conteúdo autorizado.',
    dmDescription: 'Obrigado por resgatar. O conteúdo autorizado está abaixo.',
    deliveryContent: process.env.DEFAULT_DELIVERY_CONTENT || 'Conteúdo autorizado do seu projeto.',
    thumbnailUrl: '',
    pings: {
      description: 'Escolha uma categoria para receber o cargo correspondente.',
      thumbnailUrl: '',
      enternal: '',
      divino: '',
      secret: ''
    }
  },
  keys: {},
  claims: {},
  panels: {}
};

let store = structuredClone(defaultStore);
let saveQueue = Promise.resolve();
function saveStore(next = store) {
  store = next;
  saveQueue = saveQueue.then(async () => {
    const temp = `${DB_FILE}.tmp`;
    await fs.writeFile(temp, JSON.stringify(store, null, 2), 'utf8');
    await fs.rename(temp, DB_FILE);
  });
  return saveQueue;
}

async function loadStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    return { ...defaultStore, ...JSON.parse(await fs.readFile(DB_FILE, 'utf8')) };
  } catch {
    await saveStore(defaultStore);
    return structuredClone(defaultStore);
  }
}

store = await loadStore();

function isAdmin(interaction) {
  if (interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) return true;
  const roleId = process.env.ADMIN_ROLE_ID;
  return Boolean(roleId && interaction.member?.roles?.cache?.has(roleId));
}

function newKey() {
  const raw = crypto.randomBytes(8).toString('hex').toUpperCase();
  return `HYDRA-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 16)}`;
}

function panelComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('hydra_free').setLabel('Key grátis').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('hydra_view').setLabel('Ver conteúdo').setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('hydra_reset').setLabel('Resetar resgate').setStyle(ButtonStyle.Secondary)
    )
  ];
}

function pingsComponents() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('hydra_pings_select')
    .setPlaceholder('Escolha qual cargo você quer receber')
    .addOptions(
      new StringSelectMenuOptionBuilder().setLabel('Cargo Enternal').setDescription('Receber o cargo Enternal').setValue('enternal'),
      new StringSelectMenuOptionBuilder().setLabel('Cargo Divino').setDescription('Receber o cargo Divino').setValue('divino'),
      new StringSelectMenuOptionBuilder().setLabel('Cargo Secret').setDescription('Receber o cargo Secret').setValue('secret')
    );
  return [new ActionRowBuilder().addComponents(menu)];
}

function pingsEmbed() {
  const config = store.config.pings || {};
  const embed = new EmbedBuilder()
    .setColor(0x00aaff)
    .setTitle('Hydra Hub | Escolha seu cargo')
    .setDescription(config.description || 'Escolha uma categoria para receber o cargo correspondente.')
    .addFields({ name: 'Categorias disponíveis', value: 'Selecione **Enternal**, **Divino** ou **Secret** no menu abaixo.' })
    .setFooter({ text: 'Você poderá receber o cargo selecionado automaticamente.' });
  if (config.thumbnailUrl) {
    try { embed.setThumbnail(new URL(config.thumbnailUrl).toString()); } catch {}
  }
  return embed;
}

function panelEmbed() {
  const embed = new EmbedBuilder()
    .setColor(0x00aaff)
    .setTitle('Hydra Hub | Sistema de acesso')
    .setDescription(store.config.description)
    .addFields({ name: 'Como usar', value: 'Clique em **Key grátis** para receber uma chave gratuita. Depois, use **Ver conteúdo** para receber a entrega autorizada por DM.' })
    .setFooter({ text: 'As chaves são de uso único.' });
  if (store.config.thumbnailUrl) {
    try { embed.setThumbnail(new URL(store.config.thumbnailUrl).toString()); } catch {}
  }
  return embed;
}

async function replyEphemeral(interaction, content) {
  if (interaction.replied || interaction.deferred) return interaction.followUp({ content, ephemeral: true });
  return interaction.reply({ content, ephemeral: true });
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, c => {
  console.log(`Bot conectado como ${c.user.tag}`);
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'set') {
        if (!isAdmin(interaction)) return replyEphemeral(interaction, 'Você precisa ser administrador para publicar painéis.');
        const subcommand = interaction.options.getSubcommand();
        if (subcommand === 'painel') {
          const message = await interaction.channel.send({ embeds: [panelEmbed()], components: panelComponents() });
          store.panels[message.id] = { type: 'painel', channelId: message.channel.id, createdAt: new Date().toISOString() };
          await saveStore();
          return replyEphemeral(interaction, 'Painel publicado neste canal.');
        }
        if (subcommand === 'pings') {
          const config = store.config.pings || (store.config.pings = {});
          config.enternal = interaction.options.getString('cargo_enternal');
          config.divino = interaction.options.getString('cargo_divino');
          config.secret = interaction.options.getString('cargo_secret');
          config.description = interaction.options.getString('descricao') || 'Escolha uma categoria para receber o cargo correspondente.';
          config.thumbnailUrl = interaction.options.getString('thumbnail') || '';
          const message = await interaction.channel.send({ embeds: [pingsEmbed()], components: pingsComponents() });
          store.panels[message.id] = { type: 'pings', channelId: message.channel.id, createdAt: new Date().toISOString() };
          await saveStore();
          return replyEphemeral(interaction, 'Painel de pings publicado e configuração salva.');
        }
      }

      if (interaction.commandName === 'config') {
        if (!isAdmin(interaction)) return replyEphemeral(interaction, 'Você precisa ser administrador para configurar o bot.');
        const description = interaction.options.getString('descricao');
        const dmDescription = interaction.options.getString('descricao_dm');
        const content = interaction.options.getString('conteudo');
        const thumbnail = interaction.options.getString('thumbnail');
        if (description) store.config.description = description;
        if (dmDescription) store.config.dmDescription = dmDescription;
        if (content) store.config.deliveryContent = content;
        if (thumbnail !== null) store.config.thumbnailUrl = thumbnail;
        await saveStore();
        return replyEphemeral(interaction, 'Configuração salva. O próximo painel usará os novos valores.');
      }

      if (interaction.commandName === 'gerarkeys') {
        if (!isAdmin(interaction)) return replyEphemeral(interaction, 'Você precisa ser administrador para gerar chaves.');
        const amount = Math.min(interaction.options.getInteger('quantidade') || 1, 50);
        const generated = [];
        for (let i = 0; i < amount; i += 1) {
          let key = newKey();
          while (store.keys[key]) key = newKey();
          store.keys[key] = { createdAt: new Date().toISOString(), claimedBy: null, claimedAt: null };
          generated.push(key);
        }
        await saveStore();
        return replyEphemeral(interaction, `Chaves geradas com sucesso:\n\`${generated.join('\n')}\``);
      }

      if (interaction.commandName === 'status') {
        if (!isAdmin(interaction)) return replyEphemeral(interaction, 'Você precisa ser administrador para consultar o status.');
        const total = Object.keys(store.keys).length;
        const claimed = Object.values(store.keys).filter(k => k.claimedBy).length;
        return replyEphemeral(interaction, `Chaves: **${total}** totais, **${claimed}** resgatadas, **${total - claimed}** disponíveis.`);
      }
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'hydra_pings_select') {
      const selected = interaction.values[0];
      const roleId = store.config.pings?.[selected];
      const labels = { enternal: 'Enternal', divino: 'Divino', secret: 'Secret' };
      if (!roleId) return replyEphemeral(interaction, `O cargo **${labels[selected] || selected}** ainda não foi configurado.`);
      try {
        const role = await interaction.guild.roles.fetch(roleId);
        if (!role) return replyEphemeral(interaction, 'Não encontrei esse cargo. Confira o ID configurado.');
        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (member.roles.cache.has(role.id)) return replyEphemeral(interaction, `Você já possui o cargo **${role.name}**.`);
        await member.roles.add(role, `Cargo escolhido no painel de pings por ${interaction.user.tag}`);
        return replyEphemeral(interaction, `Cargo **${role.name}** atribuído com sucesso.`);
      } catch (error) {
        console.error(error);
        return replyEphemeral(interaction, 'Não consegui atribuir o cargo. Verifique a permissão **Gerenciar cargos** e se o cargo do bot está acima do cargo escolhido.');
      }
    }

    if (interaction.isButton()) {
      if (interaction.customId === 'hydra_free') {
        if (store.claims[interaction.user.id]) return replyEphemeral(interaction, 'Você já possui um resgate ativo.');
        let key = newKey();
        while (store.keys[key]) key = newKey();
        const claimedAt = new Date().toISOString();
        store.keys[key] = { createdAt: claimedAt, claimedBy: interaction.user.id, claimedAt };
        store.claims[interaction.user.id] = { key, claimedAt, free: true };
        await saveStore();
        return replyEphemeral(interaction, `Sua Key grátis é: ${key}\nAgora clique em **Ver conteúdo** para receber o conteúdo na DM.`);
      }

      if (interaction.customId === 'hydra_view') {
        if (!store.claims[interaction.user.id]) return replyEphemeral(interaction, 'Você ainda não resgatou uma chave.');
        try {
          const dmEmbed = new EmbedBuilder()
            .setColor(0x00aaff)
            .setTitle('Hydra Hub | Conteúdo autorizado')
            .setDescription(store.config.dmDescription || 'Obrigado por resgatar. O conteúdo autorizado está abaixo.');
          if (store.config.thumbnailUrl) {
            try { dmEmbed.setThumbnail(new URL(store.config.thumbnailUrl).toString()); } catch {}
          }
          await interaction.user.send({ content: store.config.deliveryContent, embeds: [dmEmbed] });
          return replyEphemeral(interaction, 'Enviei o conteúdo autorizado na sua DM.');
        } catch {
          return replyEphemeral(interaction, 'Não consegui enviar DM. Ative as mensagens diretas neste servidor e tente novamente.');
        }
      }

      if (interaction.customId === 'hydra_reset') {
        if (!isAdmin(interaction)) return replyEphemeral(interaction, 'O reset de resgate é restrito a administradores.');
        const modal = new ModalBuilder().setCustomId('hydra_reset_modal').setTitle('Resetar resgate');
        const input = new TextInputBuilder().setCustomId('discord_id').setLabel('ID do usuário Discord').setPlaceholder('123456789012345678').setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
      }
    }

    if (interaction.isModalSubmit() && interaction.customId === 'hydra_reset_modal') {
      const userId = interaction.fields.getTextInputValue('discord_id').trim();
      const claim = store.claims[userId];
      if (!claim) return replyEphemeral(interaction, 'Esse usuário não possui resgate ativo.');
      if (store.keys[claim.key]) {
        store.keys[claim.key].claimedBy = null;
        store.keys[claim.key].claimedAt = null;
      }
      delete store.claims[userId];
      await saveStore();
      return replyEphemeral(interaction, 'Resgate resetado; a chave voltou a ficar disponível.');
    }
  } catch (error) {
    console.error(error);
    if (!interaction.replied && !interaction.deferred) await replyEphemeral(interaction, 'Ocorreu um erro interno.');
  }
});

async function registerCommands() {
  const { CLIENT_ID, GUILD_ID } = process.env;
  if (!CLIENT_ID || !GUILD_ID) {
    console.warn('CLIENT_ID ou GUILD_ID ausente; comandos slash não foram registrados automaticamente.');
    return;
  }
  const commands = [
    new SlashCommandBuilder().setName('set').setDescription('Publica um painel').addSubcommand(s => s.setName('painel').setDescription('Publica o painel de acesso neste canal')).addSubcommand(s => s.setName('pings').setDescription('Publica o painel de escolha de cargos').addStringOption(o => o.setName('cargo_enternal').setDescription('ID do cargo Enternal').setRequired(true)).addStringOption(o => o.setName('cargo_divino').setDescription('ID do cargo Divino').setRequired(true)).addStringOption(o => o.setName('cargo_secret').setDescription('ID do cargo Secret').setRequired(true)).addStringOption(o => o.setName('descricao').setDescription('Descrição da embed de pings').setRequired(false)).addStringOption(o => o.setName('thumbnail').setDescription('URL da thumbnail da embed').setRequired(false))),
    new SlashCommandBuilder().setName('config').setDescription('Configura o painel e a DM').addStringOption(o => o.setName('descricao').setDescription('Descrição do painel').setRequired(false)).addStringOption(o => o.setName('descricao_dm').setDescription('Descrição exibida na DM').setRequired(false)).addStringOption(o => o.setName('conteudo').setDescription('Conteúdo autorizado enviado por DM').setRequired(false)).addStringOption(o => o.setName('thumbnail').setDescription('URL da thumbnail; deixe vazio para remover').setRequired(false)),
    new SlashCommandBuilder().setName('gerarkeys').setDescription('Gera chaves').addIntegerOption(o => o.setName('quantidade').setDescription('Quantidade de 1 a 50').setMinValue(1).setMaxValue(50).setRequired(false)),
    new SlashCommandBuilder().setName('status').setDescription('Mostra o status das chaves')
  ].map(command => command.toJSON());
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log('Comandos slash registrados.');
}

await registerCommands();
client.login(TOKEN);
