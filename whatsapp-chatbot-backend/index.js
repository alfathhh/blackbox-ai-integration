"use strict";

const pino = require('pino');
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

require('dotenv').config();
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const { default: makeWASocket, useSingleFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require("baileys");

const { state, saveState } = useSingleFileAuthState('./auth_info.json');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_NAME = process.env.SHEET_NAME || "Sheet1";

const SERVICE_ACCOUNT_KEY_PATH = 'service-account-key.json';

const INACTIVITY_TIMEOUT = 2 * 60 * 1000; // 2 minutes

// Global variables for Google Sheets API client
let authClient;
let sheets;

// Track if bot is running to prevent multiple startBot calls
let botRunning = false;

// Authorize Google API client using service account
async function authorizeGoogle() {
    try {
        const keyFile = SERVICE_ACCOUNT_KEY_PATH;
        if (!fs.existsSync(keyFile)) {
            logger.error("Service account key file not found. Please provide service-account-key.json");
            process.exit(1);
        }
        const key = require(path.resolve(keyFile));
        authClient = new google.auth.JWT(
            key.client_email,
            null,
            key.private_key,
            ['https://www.googleapis.com/auth/spreadsheets']
        );
        await authClient.authorize();
        sheets = google.sheets({ version: 'v4', auth: authClient });
    } catch (error) {
        logger.error("Failed to authorize Google API client with service account:", error);
        process.exit(1);
    }
}

// Append chat log to Google Spreadsheet with retry logic
async function appendChatLog(timestamp, from, message, senderType, retries = 3) {
    if (!sheets) return;
    const values = [[timestamp, from, message, senderType]];
    const resource = { values };
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            await sheets.spreadsheets.values.append({
                spreadsheetId: SPREADSHEET_ID,
                range: `${SHEET_NAME}!A:D`,
                valueInputOption: 'RAW',
                resource,
            });
            break; // success
        } catch (error) {
            logger.error(`Error appending chat log (attempt ${attempt}):`, error);
            if (attempt === retries) {
                logger.error("Max retries reached for appending chat log.");
            } else {
                await new Promise(res => setTimeout(res, 1000 * attempt)); // exponential backoff
            }
        }
    }
}

// Format menu array into numbered string message
function formatMenu(title, items) {
    let message = `${title}:\n`;
    items.forEach((item, index) => {
        message += `${index + 1}. ${item}\n`;
    });
    return message.trim();
}

// Menu definitions as arrays
const MENUS = {
    main: ['Info', 'Chat dengan CS', 'Akhiri percakapan', 'Dummy Menu', 'Produk'],
    info: ['PDRB', 'Kembali ke menu sebelumnya'],
    pdrb: ['Nilai PDRB sebesar 1 juta.', 'Kembali ke menu sebelumnya'],
    dummyMenu: ['Dummy Submenu 1', 'Kembali ke menu sebelumnya'],
    dummySubmenu1: ['Kembali ke menu sebelumnya'],
    produk: ['Produk 1', 'Produk 2', 'Produk 3', 'Kembali ke menu sebelumnya'],
    produk1: ['Detail Produk 1', 'Kembali ke menu sebelumnya']
};

// Conversation class to encapsulate state and timeout
class Conversation {
    constructor() {
        this.state = 'main';
        this.csActive = false;
        this.timeout = null;
    }

    resetTimeout(sock, jid) {
        if (this.timeout) clearTimeout(this.timeout);
        this.timeout = setTimeout(async () => {
            await sendMessage(sock, jid, "Percakapan diakhiri karena tidak ada jawaban selama 2 menit.", true);
            conversations.delete(jid);
        }, INACTIVITY_TIMEOUT);
    }
}

// Conversation states per user
const conversations = new Map();

// Get current ISO timestamp
function getCurrentTimestamp() {
    return new Date().toISOString();
}

// Send message to user, appending bot signature if isBot is true
async function sendMessage(sock, jid, message, isBot = true) {
    const finalMessage = isBot ? `${message}\n\nchat digenerate oleh bot` : message;
    try {
        await sock.sendMessage(jid, { text: finalMessage });
    } catch (error) {
        logger.error("Failed to send message:", error);
    }
}

// Centralized message handler with inactivity timeout reset
async function handleMessage(sock, msg) {
    if (!msg.message || msg.key.fromMe) return;

    const jid = msg.key.remoteJid;
    const messageText = msg.message.conversation || (msg.message.extendedTextMessage && msg.message.extendedTextMessage.text) || "";

    // Log user message
    await appendChatLog(getCurrentTimestamp(), jid, messageText, 'user');

    // Initialize conversation if new user
    if (!conversations.has(jid)) {
        conversations.set(jid, new Conversation());
        await sendMessage(sock, jid, `Halo! Selamat datang.\n${formatMenu('Menu', MENUS.main)}`);
        conversations.get(jid).resetTimeout(sock, jid);
        return;
    }

    const conv = conversations.get(jid);

    // Handle customer service active state
    if (conv.csActive) {
        if (messageText.toLowerCase() === "terima kasih") {
            conv.csActive = false;
            conv.state = 'main';
            await sendMessage(sock, jid, "Percakapan kembali diambil alih oleh bot.");
            conv.resetTimeout(sock, jid);
            return;
        } else {
            // Simulate forwarding message to CS or user
            conv.resetTimeout(sock, jid);
            return;
        }
    }

    // Menu navigation logic
    switch (conv.state) {
        case 'main':
            await handleMainMenu(sock, jid, messageText, conv);
            break;
        case 'info':
            await handleInfoMenu(sock, jid, messageText, conv);
            break;
        case 'pdrb':
            await handlePdrbMenu(sock, jid, messageText, conv);
            break;
        case 'dummyMenu':
            await handleDummyMenu(sock, jid, messageText, conv);
            break;
        case 'dummySubmenu1':
            await handleDummySubmenu1(sock, jid, messageText, conv);
            break;
        case 'produk':
            await handleProdukMenu(sock, jid, messageText, conv);
            break;
        case 'produk1':
            await handleProduk1Menu(sock, jid, messageText, conv);
            break;
        default:
            conv.state = 'main';
            await sendMessage(sock, jid, formatMenu('Menu', MENUS.main));
            conv.resetTimeout(sock, jid);
            break;
    }
}

// Handlers for each menu state
async function handleMainMenu(sock, jid, messageText, conv) {
    switch (messageText) {
        case '1':
            conv.state = 'info';
            await sendMessage(sock, jid, formatMenu('Menu Info', MENUS.info));
            break;
        case '2':
            conv.csActive = true;
            await sendMessage(sock, jid, "mohon tunggu sebentar.");
            break;
        case '3':
            await sendMessage(sock, jid, "Percakapan diakhiri. Terima kasih.");
            conversations.delete(jid);
            break;
        case '4':
            conv.state = 'dummyMenu';
            await sendMessage(sock, jid, formatMenu('Dummy Menu', MENUS.dummyMenu));
            break;
        case '5':
            conv.state = 'produk';
            await sendMessage(sock, jid, formatMenu('Produk', MENUS.produk));
            break;
        default:
            await sendMessage(sock, jid, "Pilihan tidak valid. Silakan pilih menu:\n" + formatMenu('Menu', MENUS.main));
            break;
    }
    conv.resetTimeout(sock, jid);
}

async function handleInfoMenu(sock, jid, messageText, conv) {
    switch (messageText) {
        case '1':
            conv.state = 'pdrb';
            await sendMessage(sock, jid, formatMenu('Menu PDRB', MENUS.pdrb));
            break;
        case '2':
            conv.state = 'main';
            await sendMessage(sock, jid, formatMenu('Menu', MENUS.main));
            break;
        default:
            await sendMessage(sock, jid, "Pilihan tidak valid. Silakan pilih menu:\n" + formatMenu('Menu Info', MENUS.info));
            break;
    }
    conv.resetTimeout(sock, jid);
}

async function handlePdrbMenu(sock, jid, messageText, conv) {
    switch (messageText) {
        case '1':
            conv.state = 'info';
            await sendMessage(sock, jid, formatMenu('Menu Info', MENUS.info));
            break;
        default:
            await sendMessage(sock, jid, "Pilihan tidak valid. Silakan pilih menu:\n" + formatMenu('Menu PDRB', MENUS.pdrb));
            break;
    }
    conv.resetTimeout(sock, jid);
}

async function handleDummyMenu(sock, jid, messageText, conv) {
    switch (messageText) {
        case '1':
            conv.state = 'dummySubmenu1';
            await sendMessage(sock, jid, formatMenu('Dummy Submenu 1', MENUS.dummySubmenu1));
            break;
        case '2':
            conv.state = 'main';
            await sendMessage(sock, jid, formatMenu('Menu', MENUS.main));
            break;
        default:
            await sendMessage(sock, jid, "Pilihan tidak valid. Silakan pilih menu:\n" + formatMenu('Dummy Menu', MENUS.dummyMenu));
            break;
    }
    conv.resetTimeout(sock, jid);
}

async function handleDummySubmenu1(sock, jid, messageText, conv) {
    switch (messageText) {
        case '1':
            conv.state = 'dummyMenu';
            await sendMessage(sock, jid, formatMenu('Dummy Menu', MENUS.dummyMenu));
            break;
        default:
            await sendMessage(sock, jid, "Pilihan tidak valid. Silakan pilih menu:\n" + formatMenu('Dummy Submenu 1', MENUS.dummySubmenu1));
            break;
    }
    conv.resetTimeout(sock, jid);
}

async function handleProdukMenu(sock, jid, messageText, conv) {
    switch (messageText) {
        case '1':
            conv.state = 'produk1';
            await sendMessage(sock, jid, formatMenu('Detail Produk 1', MENUS.produk1));
            break;
        case '2':
        case '3':
            // For simplicity, stay in produk menu for Produk 2 and 3
            await sendMessage(sock, jid, formatMenu('Produk', MENUS.produk));
            break;
        case '4':
            conv.state = 'main';
            await sendMessage(sock, jid, formatMenu('Menu', MENUS.main));
            break;
        default:
            await sendMessage(sock, jid, "Pilihan tidak valid. Silakan pilih menu:\n" + formatMenu('Produk', MENUS.produk));
            break;
    }
    conv.resetTimeout(sock, jid);
}

async function handleProduk1Menu(sock, jid, messageText, conv) {
    switch (messageText) {
        case '1':
            conv.state = 'produk';
            await sendMessage(sock, jid, formatMenu('Produk', MENUS.produk));
            break;
        default:
            await sendMessage(sock, jid, "Pilihan tidak valid. Silakan pilih menu:\n" + formatMenu('Detail Produk 1', MENUS.produk1));
            break;
    }
    conv.resetTimeout(sock, jid);
}

// Start the WhatsApp bot
async function startBot() {
    if (botRunning) {
        logger.info("Bot is already running, skipping start.");
        return;
    }
    botRunning = true;

    await authorizeGoogle();

    const { version, isLatest } = await fetchLatestBaileysVersion();
    logger.info(`Using WA version v${version.join('.')}, isLatest: ${isLatest}`);

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: true,
    });

    sock.ev.on('creds.update', saveState);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            logger.info('connection closed due to ', lastDisconnect.error, ', reconnecting ', shouldReconnect);
            if (shouldReconnect) {
                botRunning = false;
                startBot();
            } else {
                botRunning = false;
            }
        } else if (connection === 'open') {
            logger.info('opened connection');
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        if (!m.messages || m.type !== 'notify') return;
        const msg = m.messages[0];
        await handleMessage(sock, msg);
    });
}

startBot().catch(err => logger.error(err));
