const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = require("@whiskeysockets/baileys");
const pino = require("pino");
const qrcode = require("qrcode-terminal");
const fs = require("fs");
const chalk = require("chalk");

// Your WhatsApp number (owner) – fixed for Ghana
const OWNER_NUMBER = "233278104843"; // your Ghana number

// Create sessions folder if not exist
if (!fs.existsSync('./sessions')) fs.mkdirSync('./sessions');

// Pending and approved pairs
let pendingPairs = {};
let approvedPairs = [];

// Active sockets
let activeSockets = {};

// Start WhatsApp session
async function startSession(phoneNumber) {
    const { state, saveCreds } = await useMultiFileAuthState(`./sessions/${phoneNumber}`);
    const { version } = await fetchLatestBaileysVersion();
    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: true,
        auth: state
    });

    sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
        if (qr) {
            console.log(chalk.yellowBright(`Scan QR for ${phoneNumber}:`));
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'open') {
            console.log(chalk.greenBright(`🦂 ScopionMod Bot connected for ${phoneNumber}`));
        }
        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason !== 401) startSession(phoneNumber);
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;
        const text = m.message.conversation || m.message.extendedTextMessage?.text;
        if (!text) return;

        const from = m.key.remoteJid;
        const isGroup = from.endsWith('@g.us');
        const sender = m.key.participant || m.key.remoteJid;
        const isOwner = sender.includes(OWNER_NUMBER);

        // --- PAIRING SYSTEM ---
        if (text.startsWith("/pair") && !isOwner) {
            const code = Math.floor(100000 + Math.random()*900000).toString();
            pendingPairs[code] = from;
            await sock.sendMessage(from, { text: `Your pairing code: ${code}\nSend to owner to approve.` });
            return;
        }

        if (text.startsWith("/approve") && isOwner) {
            const parts = text.split(" ");
            const code = parts[1];
            if (pendingPairs[code]) {
                const userNumber = pendingPairs[code];
                approvedPairs.push(userNumber);
                startSession(userNumber); // create session for friend
                delete pendingPairs[code];
                await sock.sendMessage(from, { text: `✅ Pairing approved for ${userNumber.split("@")[0]}` });
            } else {
                await sock.sendMessage(from, { text: "❌ Invalid pairing code." });
            }
            return;
        }

        // Ignore messages from unapproved users
        if (!isOwner && !approvedPairs.includes(sender)) return;

        // --- COMMANDS ---
        switch(text.toLowerCase()) {
            case ".menu":
                await sock.sendMessage(from, { text: `
🦂 *SCOPIONMOD BOT MENU*

*General Commands*
.ping
.alive
.owner
.menu

*Group Commands* (group only)
.kick
.promote
.demote
.tagall
.hidetag
.antilink
.autoreact`
                });
                break;
            case ".ping":
                await sock.sendMessage(from, { text: "🏓 Pong! Bot is alive." });
                break;
            case ".alive":
                await sock.sendMessage(from, { text: "🟢 ScopionMod Bot is online!" });
                break;
            case ".owner":
                await sock.sendMessage(from, { text: `Owner: ${OWNER_NUMBER}` });
                break;
            case ".tagall":
                if (!isGroup) return;
                let groupMeta = await sock.groupMetadata(from);
                let members = groupMeta.participants.map(u => `@${u.id.split('@')[0]}`);
                await sock.sendMessage(from, { text: members.join(' '), mentions: groupMeta.participants.map(u => u.id) });
                break;
            case ".kick":
            case ".promote":
            case ".demote":
            case ".hidetag":
            case ".antilink":
            case ".autoreact":
                await sock.sendMessage(from, { text: "⚡ This command placeholder will be upgraded later!" });
                break;
        }
    });

    activeSockets[phoneNumber] = sock;
}

// Start owner session
startSession(OWNER_NUMBER);
