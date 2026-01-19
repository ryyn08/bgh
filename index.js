const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    generateForwardMessageContent, 
    prepareWAMessageMedia, 
    generateWAMessageFromContent, 
    generateMessageID, 
    downloadContentFromMessage, 
    makeInMemoryStore, 
    jidDecode, 
    proto 
} = require("@whiskeysockets/baileys");
const pino = require('pino');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const axios = require('axios');
const chalk = require('chalk');
const { Sticker, createSticker, StickerTypes } = require('wa-sticker-formatter');

const phoneNumber = "6285883881264";
const usePairingCode = true;
const store = makeInMemoryStore({ logger: pino().child({ level: 'silent', stream: 'store' }) });

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("./session");
    const { version } = await fetchLatestBaileysVersion();

    const ryyn = makeWASocket({
        logger: pino({ level: 'fatal' }), // Memperbaiki logger agar tidak spam error
        printQRInTerminal: !usePairingCode,
        auth: state,
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        version
    });

    if (usePairingCode && !ryyn.authState.creds.registered) {
        setTimeout(async () => {
            let code = await ryyn.requestPairingCode(phoneNumber);
            code = code?.match(/.{1,4}/g)?.join("-") || code;
            console.log(chalk.black(chalk.bgGreen(` RY-BOT PAIRING CODE: `)), chalk.black(chalk.bgWhite(` ${code} `)));
        }, 3000);
    }

    ryyn.ev.on('creds.update', saveCreds);

    ryyn.ev.on('messages.upsert', async chatUpdate => {
        try {
            const m = chatUpdate.messages[0];
            if (!m.message) return;
            if (m.key && m.key.remoteJid === 'status@broadcast') return;

            const from = m.key.remoteJid;
            const type = Object.keys(m.message)[0];
            const body = (type === 'conversation') ? m.message.conversation : (type === 'extendedTextMessage') ? m.message.extendedTextMessage.text : (type === 'imageMessage') ? m.message.imageMessage.caption : (type === 'videoMessage') ? m.message.videoMessage.caption : '';
            const prefix = /^[\\/!#.]/.test(body) ? body.match(/^[\\/!#.]/)[0] : '/';
            const command = body.startsWith(prefix) ? body.slice(prefix.length).trim().split(/ +/).shift().toLowerCase() : '';
            const args = body.trim().split(/ +/).slice(1);
            const text = args.join(" ");
            const isOwner = ["6285883881264@s.whatsapp.net"].includes(from);

            // Fungsi Reply Sederhana
            const reply = (teks) => {
                ryyn.sendMessage(from, { text: teks }, { quoted: m });
            };

            switch (command) {
                case 'menu': {
                    let menuTeks = `┏──『 *RYYN BOTZ* 』──┓
│
│ 🛠️ *MAIN MENU*
│ ◦ ${prefix}getsw (Reply Status)
│ ◦ ${prefix}rvo (Read ViewOnce)
│ ◦ ${prefix}sbrat (Teks ke Sticker)
│
┗──────────────────┛`;
                    reply(menuTeks);
                }
                break;

                case 'getsw': {
                    if (!m.message.extendedTextMessage?.contextInfo?.quotedMessage) return reply('Reply pesan Status yang ingin kamu ambil!');
                    const quoted = m.message.extendedTextMessage.contextInfo.quotedMessage;
                    const mime = quoted.imageMessage?.mimetype || quoted.videoMessage?.mimetype || '';
                    
                    if (/image/.test(mime) || /video/.test(mime)) {
                        const stream = await downloadContentFromMessage(quoted.imageMessage || quoted.videoMessage, /image/.test(mime) ? 'image' : 'video');
                        let buffer = Buffer.from([]);
                        for await(const chunk of stream) { buffer = Buffer.concat([buffer, chunk]) }
                        
                        if (/image/.test(mime)) {
                            await ryyn.sendMessage(from, { image: buffer, caption: `📸 Status dari: @${from.split('@')[0]}` }, { quoted: m });
                        } else {
                            await ryyn.sendMessage(from, { video: buffer, caption: `🎥 Status dari: @${from.split('@')[0]}` }, { quoted: m });
                        }
                    } else {
                        reply('Hanya bisa mengambil foto atau video.');
                    }
                }
                break;

                case 'rvo': case 'readviewonce': {
                    const q = m.message.extendedTextMessage?.contextInfo?.quotedMessage;
                    if (!q) return reply('Reply pesan ViewOnce!');
                    const viewOnce = q.viewOnceMessageV2?.message || q.viewOnceMessage?.message;
                    if (!viewOnce) return reply('Itu bukan pesan ViewOnce!');

                    const vType = Object.keys(viewOnce)[0];
                    const media = await downloadContentFromMessage(viewOnce[vType], vType.replace('Message', ''));
                    let buffer = Buffer.from([]);
                    for await(const chunk of media) { buffer = Buffer.concat([buffer, chunk]) }

                    if (/image/.test(vType)) {
                        await ryyn.sendMessage(from, { image: buffer, caption: viewOnce[vType].caption }, { quoted: m });
                    } else if (/video/.test(vType)) {
                        await ryyn.sendMessage(from, { video: buffer, caption: viewOnce[vType].caption }, { quoted: m });
                    }
                }
                break;

                case 'sbrat': {
                    if (!text) return reply(`Ketik: ${prefix + command} teks yang ingin dijadikan sticker`);
                    reply('Sedang memproses...');
                    const bratUrl = `https://brat.siputzx.my.id/image?text=${encodeURIComponent(text)}&background=%23ffffff&color=%23000000&emojiStyle=apple`;
                    
                    const sticker = new Sticker(bratUrl, {
                        pack: 'Ryyn Botz',
                        author: 'ryyn tamvan',
                        type: StickerTypes.FULL,
                        categories: ['🤩', '🎉'],
                        id: '12345',
                        quality: 70,
                    });
                    const stickerBuffer = await sticker.toBuffer();
                    await ryyn.sendMessage(from, { sticker: stickerBuffer }, { quoted: m });
                }
                break;
            }

        } catch (err) {
            console.log(chalk.red("Error Handling Message: "), err);
        }
    });

    ryyn.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            let shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log(chalk.green('Bot berhasil tersambung ke WhatsApp!'));
        }
    });
}

startBot();
