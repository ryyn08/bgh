const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeInMemoryStore,
    downloadContentFromMessage,
    jidDecode,
    generateForwardMessageContent,
    prepareWAMessageMedia,
    generateWAMessageFromContent,
    generateMessageID,
    downloadHistory,
    proto,
    getMessage,
    generateWAMessageContent
} = require("@whiskeysockets/baileys");
const pino = require('pino');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const chalk = require('chalk');
const { sticker, addMetadata } = require('./lib/sticker'); // Pastikan library ini ada atau gunakan wa-sticker-formatter
const { Sticker, createSticker, StickerTypes } = require('wa-sticker-formatter');

const phoneNumber = "6283119396819";
const usePairingCode = true;

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("./session");
    const { version } = await fetchLatestBaileysVersion();

    const ryyn = makeWASocket({
        logger: pino({ level: 'silent' }), // Fixed: Pino silent agar tidak spam
        printQRInTerminal: !usePairingCode,
        auth: state,
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        version
    });

    // Sistem Pairing Code
    if (usePairingCode && !ryyn.authState.creds.registered) {
        setTimeout(async () => {
            let code = await ryyn.requestPairingCode(phoneNumber);
            code = code?.match(/.{1,4}/g)?.join("-") || code;
            console.log(chalk.black(chalk.bgGreen(` RY-MD PAIRING CODE: `)), chalk.black(chalk.bgWhite(` ${code} `)));
        }, 3000);
    }

    ryyn.ev.on('creds.update', saveCreds);

    ryyn.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            let shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Koneksi terputus, mencoba menyambung kembali...', shouldReconnect);
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log(chalk.green('✅ Bot Berhasil Terhubung Ke WhatsApp!'));
        }
    });

    ryyn.ev.on('messages.upsert', async chatUpdate => {
        try {
            const m = chatUpdate.messages[0];
            if (!m.message) return;
            const from = m.key.remoteJid;
            const type = Object.keys(m.message)[0];
            const pushname = m.pushName || "No Name";
            const budy = (type === 'conversation') ? m.message.conversation : (type === 'extendedTextMessage') ? m.message.extendedTextMessage.text : (type === 'imageMessage') ? m.message.imageMessage.caption : (type === 'videoMessage') ? m.message.videoMessage.caption : '';
            const prefix = /^[°•π÷×¶∆£¢€¥®™✓_=|~!?@#$%^&.+-,\/\\©^]/.test(budy) ? budy.match(/^[°•π÷×¶∆£¢€¥®™✓_=|~!?@#$%^&.+-,\/\\©^]/)[0] : '.';
            const command = budy.startsWith(prefix) ? budy.slice(prefix.length).trim().split(/ +/).shift().toLowerCase() : '';
            const args = budy.trim().split(/ +/).slice(1);
            const text = args.join(" ");
            const isGroup = from.endsWith('@g.us');
            const groupMetadata = isGroup ? await ryyn.groupMetadata(from) : '';
            const groupName = isGroup ? groupMetadata.subject : '';

            // LOGGING SYSTEM
            if (m.message) {
                if (isGroup) {
                    console.log(chalk.black(chalk.bgWhite(' GROUP CHAT ')), chalk.black(chalk.bgGreen(new Date().toLocaleTimeString())), chalk.magenta(budy || type), 'dari', chalk.blue(pushname), 'di', chalk.yellow(groupName));
                } else {
                    console.log(chalk.black(chalk.bgCyan(' PRIVATE CHAT ')), chalk.black(chalk.bgGreen(new Date().toLocaleTimeString())), chalk.magenta(budy || type), 'dari', chalk.blue(pushname));
                }
            }

            // COMMAND HANDLER
            switch (command) {
                case 'menu':
                case 'help': {
                    let menu = `╭───「 *RYYN BOTZ* 」───╼
│ 👋 Hai *${pushname}*
│ 
│ 🤖 *MAIN MENU*
│ ◦ ${prefix}getsw (Reply Status)
│ ◦ ${prefix}rvo (Reply ViewOnce)
│ ◦ ${prefix}sbrat (Teks)
│
╰────────────────╼`;
                    await ryyn.sendMessage(from, { text: menu }, { quoted: m });
                }
                break;

                case 'getsw': {
                    if (!m.message.extendedTextMessage?.contextInfo?.quotedMessage) return ryyn.sendMessage(from, { text: 'Reply status WhatsApp seseorang!' });
                    let quoted = m.message.extendedTextMessage.contextInfo.quotedMessage;
                    let mime = quoted.imageMessage?.mimetype || quoted.videoMessage?.mimetype;
                    
                    if (/image|video/.test(mime)) {
                        let download = await downloadContentFromMessage(quoted.imageMessage || quoted.videoMessage, mime.split('/')[0]);
                        let buffer = Buffer.from([]);
                        for await (const chunk of download) { buffer = Buffer.concat([buffer, chunk]); }
                        
                        await ryyn.sendMessage(from, { [mime.split('/')[0]]: buffer, caption: '✅ Status Berhasil Diambil' }, { quoted: m });
                    } else {
                        ryyn.sendMessage(from, { text: 'Media tidak dikenali.' });
                    }
                }
                break;

                case 'rvo': {
                    let q = m.message.extendedTextMessage?.contextInfo?.quotedMessage || m.message;
                    let viewOnce = q.viewOnceMessageV2?.message || q.viewOnceMessage?.message;
                    if (!viewOnce) return ryyn.sendMessage(from, { text: 'Itu bukan pesan ViewOnce!' });
                    
                    let vType = Object.keys(viewOnce)[0];
                    let media = await downloadContentFromMessage(viewOnce[vType], vType.replace('Message', ''));
                    let buffer = Buffer.from([]);
                    for await (const chunk of media) { buffer = Buffer.concat([buffer, chunk]); }
                    
                    if (/video/.test(vType)) {
                        await ryyn.sendMessage(from, { video: buffer, caption: viewOnce[vType].caption }, { quoted: m });
                    } else {
                        await ryyn.sendMessage(from, { image: buffer, caption: viewOnce[vType].caption }, { quoted: m });
                    }
                }
                break;

                case 'sbrat': {
                    if (!text) return ryyn.sendMessage(from, { text: `Contoh: ${prefix + command} hello world` });
                    const axios = require('axios');
                    let api = `https://brat.siputzx.my.id/image?text=${encodeURIComponent(text)}&background=%23ffffff&color=%23000000&emojiStyle=apple`;
                    
                    let sticker = new Sticker(api, {
                        pack: 'Ryyn Botz',
                        author: 'ryyn tamvan',
                        type: StickerTypes.FULL,
                        categories: ['🤩', '🎉'],
                        id: '12345',
                        quality: 70,
                    });
                    
                    const stikerBuffer = await sticker.toBuffer();
                    await ryyn.sendMessage(from, { sticker: stikerBuffer }, { quoted: m });
                }
                break;
            }

        } catch (err) {
            console.log(chalk.red("Error Handling Message: "), err);
        }
    });
}

startBot();
