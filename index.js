// ============================================================
// index.js
// ALJESAT BOT
//
// Main Entry Point - يبدأ البوت ويربط جميع الملفات
// ============================================================

"use strict";

// ============================================================
// Core
// ============================================================

const {
    startBot,
    configureHandlers,
    getDb,
    saveDb,
    jidToNumber,
    isGroupJid,
    isOwner,
    cleanNumber  // ✅ تمت الإضافة
} = require("./bot");

const fs = require("fs");
const path = require("path");

// ============================================================
// Commands
// ============================================================

const {
    handleCommand,
    getNormalizedCommand
} = require("./commands");

// ============================================================
// Admin
// ============================================================

const {
    handleGroupJoin,
    startAdminMonitoring,
    stopAdminMonitoring,
    handleAdminCommand
} = require("./admin");

// ============================================================
// Menu Games
// ============================================================

const {
    activeGames
} = require("./menu");

// ============================================================
// Duel Games
// ============================================================

const {
    activeCasinos,
    isSarahaActive
} = require("./duel");

// ============================================================
// Saraha Game
// ============================================================

const {
    activeSaraha,
    handleSarahaCommand,
    checkSarahaActive
} = require("./saraha");

// ============================================================
// Mazad System
// ============================================================

const {
    activeMazads,
    handleMazadCommand,
    checkMazadActive,
    handleMazadBid,
    handleMazadInventory,
    handleMazadSend,
    handleMazadCancelSend
} = require("./mzad");

// ============================================================
// Colors Game
// ============================================================

const {
    activeColors,
    handleColorsCommand,
    checkColorsActive
} = require("./colors");

// ============================================================
// Animals Game
// ============================================================

const {
    activeAnimals,
    handleAnimalsCommand,
    checkAnimalsActive
} = require("./animals");

// ============================================================
// Runtime
// ============================================================

let reconnectTimer = null;
let autoSaveInterval = null;
let autoSaveEnabled = false;
let autoSaveGroupJid = null;

// ============================================================
// معالج الأخطاء العام (شبكة أمان)
// ============================================================

process.on('uncaughtException', (error) => {
    console.error('❌ خطأ غير متوقع (Uncaught Exception):', error?.stack || error?.message || error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ رفض وعد غير معالج (Unhandled Rejection):', reason?.stack || reason?.message || reason);
});

// ============================================================
// استخراج النص من الرسالة
// ============================================================

function getMessageTextFromMsg(msg) {
    if (!msg || !msg.message) return "";

    const message = msg.message;

    return (
        message.conversation ||
        message.extendedTextMessage?.text ||
        message.imageMessage?.caption ||
        message.videoMessage?.caption ||
        message.documentMessage?.caption ||
        message.buttonsResponseMessage?.selectedButtonId ||
        message.listResponseMessage?.singleSelectReply?.selectedRowId ||
        message.templateButtonReplyMessage?.selectedId ||
        ""
    ).trim();
}

// ============================================================
// Sender
// ============================================================

function getSender(msg, sock) {
    try {
        if (msg?.key?.fromMe) {
            return sock?.user?.id || "";
        }
        return msg?.key?.participant || msg?.key?.remoteJid || "";
    } catch (error) {
        console.error("❌ خطأ في getSender:", error?.message || error);
        return "";
    }
}

// ============================================================
// Bot Number
// ============================================================

function getBotNumber(sock) {
    try {
        return jidToNumber(sock?.user?.id || "");
    } catch (error) {
        console.error("❌ خطأ في getBotNumber:", error?.message || error);
        return "";
    }
}

// ============================================================
// Ignore Messages
// ============================================================

function shouldIgnoreMessage(msg) {
    try {
        if (!msg?.message) return true;

        const jid = msg?.key?.remoteJid;
        if (!jid) return true;

        if (jid === "status@broadcast") return true;

        if (msg?.key?.fromMe) {
            const text = getMessageTextFromMsg(msg);
            return !text || !text.startsWith(".");
        }

        return false;
    } catch (error) {
        console.error("❌ خطأ في shouldIgnoreMessage:", error?.message || error);
        return true;
    }
}

// ============================================================
// تحديث مراقبة الإشراف
// ============================================================

function setupAdminMonitoring(sock) {
    try {
        const db = getDb();
        if (!db) {
            console.warn("⚠️ قاعدة البيانات غير متوفرة لبدء مراقبة الإشراف.");
            return;
        }

        stopAdminMonitoring();
        startAdminMonitoring(sock, db, saveDb);
        console.log("✅ تم بدء مراقبة الإشراف.");
    } catch (error) {
        console.error("❌ خطأ في setupAdminMonitoring:", error?.message || error);
    }
}

// ============================================================
// ════════════════════════════════════════════════════
// ميزة مراقبة المغادرين وحذف الألقاب
// ════════════════════════════════════════════════════
// ============================================================

async function handleLeaveRemoveNickname(sock, update, db) {
    try {
        if (!update || typeof update !== "object") return false;

        const { id, participants, action } = update;

        if (action !== "remove" || !id || !Array.isArray(participants) || participants.length === 0) {
            return false;
        }

        if (!db.organizedGroups || !db.organizedGroups[id]) {
            return false;
        }

        for (const participant of participants) {
            const cleanNum = cleanNumber(participant);
            if (!cleanNum) continue;

            const user = db.users && db.users[cleanNum];
            if (!user) continue;

            if (user.nickname && String(user.nickname).trim()) {
                user.nickname = "";
                console.log(`🗑️ تم حذف لقب العضو ${cleanNum} بعد مغادرته القروب ${id}`);
            }
        }

        if (typeof saveDb === "function") {
            saveDb();
        }

        return true;

    } catch (error) {
        console.error("❌ خطأ في handleLeaveRemoveNickname:", error?.message || error);
        return false;
    }
}

// ============================================================
// ════════════════════════════════════════════════════
// ميزة الحفظ التلقائي لـ database.json
// ════════════════════════════════════════════════════
// ============================================================

const DB_FILE = path.join(__dirname, "database.json");

function getDatabaseContent() {
    try {
        if (fs.existsSync(DB_FILE)) {
            const content = fs.readFileSync(DB_FILE, "utf8");
            return content;
        }
        return null;
    } catch (error) {
        console.error("❌ خطأ في قراءة database.json:", error?.message || error);
        return null;
    }
}

async function sendDatabaseBackup(sock) {
    if (!autoSaveEnabled || !autoSaveGroupJid || !sock) return;

    try {
        const dbContent = getDatabaseContent();
        if (!dbContent) {
            console.warn("⚠️ لا يمكن قراءة database.json لإرسال النسخة الاحتياطية");
            return;
        }

        const maxLength = 65536;
        const parts = [];
        
        if (dbContent.length > maxLength) {
            for (let i = 0; i < dbContent.length; i += maxLength) {
                parts.push(dbContent.substring(i, i + maxLength));
            }
        } else {
            parts.push(dbContent);
        }

        const timestamp = new Date().toLocaleString('ar-EG', {
            timeZone: 'Africa/Cairo',
            hour12: false,
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

        for (let i = 0; i < parts.length; i++) {
            const isLast = i === parts.length - 1;
            const header = `📦 *نسخة احتياطية من database.json*\n🕐 التاريخ: ${timestamp}\n📊 الجزء ${i + 1}/${parts.length}\n\n`;
            const footer = isLast ? `\n\n✅ تم حفظ نسخة احتياطية بنجاح ✅` : '';
            
            await sock.sendMessage(autoSaveGroupJid, {
                text: header + parts[i] + footer
            });
        }

        console.log(`✅ تم إرسال نسخة احتياطية من database.json إلى ${autoSaveGroupJid}`);

    } catch (error) {
        console.error("❌ خطأ في إرسال النسخة الاحتياطية:", error?.message || error);
    }
}

function startAutoSave(sock, jid) {
    if (autoSaveInterval) {
        clearInterval(autoSaveInterval);
        autoSaveInterval = null;
    }

    autoSaveEnabled = true;
    autoSaveGroupJid = jid;

    setTimeout(() => {
        sendDatabaseBackup(sock);
    }, 3000);

    autoSaveInterval = setInterval(() => {
        sendDatabaseBackup(sock);
    }, 4 * 60 * 60 * 1000);

    console.log(`✅ تم تفعيل الحفظ التلقائي لـ database.json كل 4 ساعات في المجموعة ${jid}`);
}

function stopAutoSave() {
    if (autoSaveInterval) {
        clearInterval(autoSaveInterval);
        autoSaveInterval = null;
    }
    autoSaveEnabled = false;
    autoSaveGroupJid = null;
    console.log("🛑 تم إيقاف الحفظ التلقائي لـ database.json");
}

// ============================================================
// معالجة الأوامر الخاصة بالردود (في نص الرسالة العادية)
// ============================================================

async function handleAutoReplies(sock, jid, msg, text, sender, cleanSender, db, saveDb) {
    try {
        if (isSarahaActive && isSarahaActive(jid)) return;

        if (db.repliesEnabled && db.repliesEnabled[jid]) {
            const badWords = ["كول خرا", "كول خراا", "يلعون", "يلعن امك", "يلعن ابوك"];
            const isBadWord = badWords.some(word => text.includes(word));

            if (isBadWord) {
                let isAdminUser = false;
                try {
                    const metadata = await sock.groupMetadata(jid);
                    const participant = metadata.participants.find(p => p.id === sender);
                    if (participant && (participant.admin === "admin" || participant.admin === "superadmin")) {
                        isAdminUser = true;
                    }
                } catch (_) {}

                if (isAdminUser) {
                    await sock.sendMessage(jid, {
                        text: `═════════════════════
لولا رتبتك لكنت اعطيتك درسا عن الردود
═════════════════════`
                    });
                } else {
                    await sock.sendMessage(jid, {
                        text: `═════════════════
الخرا لسانه خرا مع الكل
═════════════════`
                    });
                }
                return;
            }
        }

        if (db.ahaEnabled && db.ahaEnabled[jid]) {
            const ahaPattern = /احا{1,}/;
            if (ahaPattern.test(text)) {
                db.ahaCooldown = db.ahaCooldown || {};
                const now = Date.now();
                const lastAha = db.ahaCooldown[jid] || 0;

                if (now - lastAha > 5 * 60 * 1000) {
                    db.ahaCooldown[jid] = now;
                    saveDb();

                    await sock.sendMessage(jid, {
                        text: `═════ احا وأخواتها ═════
احا. احيه. احوه. احات. احاوات.اح
══════════════════`
                    });
                }
                return;
            }
        }

        if (db.quietEnabled && db.quietEnabled[jid]) {
            db.quietTimer = db.quietTimer || {};
            if (db.quietTimer[jid]) {
                db.quietTimer[jid].lastMessageTime = Date.now();
                db.quietTimer[jid].sent = false;
                saveDb();
            }
        }

    } catch (error) {
        console.error("❌ خطأ في handleAutoReplies:", error?.message || error);
    }
}

// ============================================================
// Handlers
// ============================================================

function createHandlers() {
    return {
        onConnectionOpen: async (sock) => {
            console.log("🔄 جارٍ تهيئة الخدمات...");
            setupAdminMonitoring(sock);

            const db = getDb();
            if (db && db.autoSaveEnabled && db.autoSaveGroupJid) {
                const jid = db.autoSaveGroupJid;
                console.log(`🔄 إعادة تفعيل الحفظ التلقائي في المجموعة ${jid}`);
                startAutoSave(sock, jid);
            }

            console.log("✅ جميع الخدمات جاهزة.");
        },

        onConnectionClose: async (sock, update) => {
            console.log("🔄 جارٍ إيقاف الخدمات بسبب انقطاع الاتصال...");
            stopAdminMonitoring();
            console.log("✅ تم إيقاف الخدمات مؤقتاً.");
        },

        onMessage: async (sock, event, context) => {
            try {
                const { messages, type } = event || {};

                if (type !== "notify") return;
                if (!Array.isArray(messages) || messages.length === 0) return;

                const db = context.db || getDb();

                for (const msg of messages) {
                    try {
                        if (shouldIgnoreMessage(msg)) continue;

                        const jid = msg?.key?.remoteJid;
                        if (!jid) continue;

                        const text = getMessageTextFromMsg(msg);
                        if (!text) continue;

                        const sender = getSender(msg, sock);
                        const cleanSender = jidToNumber(sender);
                        const isGroup = isGroupJid(jid);
                        const botNumber = getBotNumber(sock);
                        const owner = isOwner(cleanSender, sock, msg);

                        if (!text.startsWith(".")) {
                            await handleAutoReplies(sock, jid, msg, text, sender, cleanSender, db, saveDb);
                            continue;
                        }

                        if (text.startsWith(".")) {
                            // أمر .حفظ
                            if (text === ".حفظ" || text.startsWith(".حفظ ")) {
                                const parts = text.split(/\s+/);
                                const action = parts.length > 1 ? parts[1].toLowerCase() : "";

                                if (!owner) {
                                    await sock.sendMessage(jid, {
                                        text: "⛔ هذا الأمر للمطور فقط.",
                                        quoted: msg
                                    });
                                    continue;
                                }

                                if (action === "on") {
                                    db.autoSaveEnabled = true;
                                    db.autoSaveGroupJid = jid;
                                    saveDb();
                                    startAutoSave(sock, jid);

                                    await sock.sendMessage(jid, {
                                        text: `✅ *تم تفعيل الحفظ التلقائي*\n\n📂 سيتم حفظ نسخة من database.json\n🕐 كل 4 ساعات\n📍 في هذا القروب\n\n📌 سيتم إرسال أول نسخة خلال 3 ثواني.`,
                                        quoted: msg
                                    });

                                } else if (action === "off") {
                                    db.autoSaveEnabled = false;
                                    db.autoSaveGroupJid = null;
                                    saveDb();
                                    stopAutoSave();

                                    await sock.sendMessage(jid, {
                                        text: `❌ *تم إيقاف الحفظ التلقائي*\n\n📂 لن يتم إرسال نسخ احتياطية من database.json بعد الآن.`,
                                        quoted: msg
                                    });

                                } else {
                                    const status = db.autoSaveEnabled ? "🟢 مفعّل" : "🔴 غير مفعّل";
                                    const group = db.autoSaveGroupJid || "لم يتم التحديد";
                                    await sock.sendMessage(jid, {
                                        text: `📊 *حالة الحفظ التلقائي*\n\n📂 الحالة: ${status}\n📍 المجموعة: ${group}\n🕐 التكرار: كل 4 ساعات\n\n.حفظ on - لتفعيل\n.حفظ off - لإيقاف`,
                                        quoted: msg
                                    });
                                }
                                continue;
                            }

                            // أمر المزاد السري
                            if (text === ".548484") {
                                if (!owner) {
                                    try {
                                        await sock.sendMessage(jid, { delete: msg.key });
                                    } catch (_) {}
                                    
                                    await sock.sendMessage(jid, {
                                        text: "⛔ هذا الأمر للمطور فقط.",
                                        quoted: msg
                                    });
                                    continue;
                                }

                                try {
                                    await sock.sendMessage(jid, { delete: msg.key });
                                } catch (_) {}
                                
                                db.mazadCreator = cleanSender;
                                saveDb();
                                
                                await sock.sendMessage(jid, {
                                    text: "✅ تم تفعيل وضع منشئ المزاد. يمكنك الآن استخدام .مزاد",
                                    quoted: msg
                                });
                                continue;
                            }

                            // أمر المزاد
                            if (text === ".مزاد") {
                                const handled = await handleMazadCommand(
                                    sock, jid, msg, db, saveDb, cleanSender, owner
                                );
                                if (handled) continue;
                            }

                            // أمر .ادفع
                            if (text.startsWith(".ادفع")) {
                                const parts = text.split(/\s+/);
                                const amount = parseInt(parts[1]);
                                if (!isNaN(amount) && amount > 0) {
                                    const handled = await handleMazadBid(
                                        sock, jid, msg, db, saveDb, cleanSender, amount
                                    );
                                    if (handled) continue;
                                }
                            }

                            // أمر .مخزوني
                            if (text === ".مخزوني") {
                                const handled = await handleMazadInventory(
                                    sock, jid, msg, db, cleanSender
                                );
                                if (handled) continue;
                            }

                            // أمر .ارسال
                            if (text.startsWith(".ارسال")) {
                                const handled = await handleMazadSend(
                                    sock, jid, msg, text, db, saveDb, cleanSender
                                );
                                if (handled) continue;
                            }

                            // أمر .الغاء
                            if (text === ".الغاء") {
                                const handled = await handleMazadCancelSend(
                                    sock, jid, msg, db, saveDb, cleanSender
                                );
                                if (handled) continue;
                            }

                            // أمر الصراحة
                            if (text === ".صراحة") {
                                const handled = await handleSarahaCommand(
                                    sock, jid, msg, db, saveDb, cleanSender, owner
                                );
                                if (handled) continue;
                            }

                            // أمر الألوان
                            if (text === ".الوان") {
                                const handled = await handleColorsCommand(
                                    sock, jid, msg, db, saveDb, cleanSender, owner
                                );
                                if (handled) continue;
                            }

                            // أمر الحيوانات
                            if (text === ".الحيوانات") {
                                const handled = await handleAnimalsCommand(
                                    sock, jid, msg, db, saveDb, cleanSender, owner
                                );
                                if (handled) continue;
                            }

                            // الأوامر الأخرى
                            const handled = await handleCommand(
                                sock,
                                jid,
                                msg,
                                {
                                    db,
                                    sender,
                                    cleanSender,
                                    isGroup,
                                    isBotOwner: Boolean(owner),
                                    botNumber,
                                    text
                                }
                            );

                            if (handled) continue;
                        }

                    } catch (error) {
                        console.error("❌ خطأ في معالجة رسالة:", error?.stack || error?.message || error);
                        try {
                            await sock.sendMessage(jid, {
                                text: "⚠️ حدث خطأ أثناء معالجة طلبك. يرجى المحاولة مرة أخرى.",
                                quoted: msg
                            });
                        } catch (_) {}
                    }
                }

            } catch (error) {
                console.error("❌ خطأ في onMessage:", error?.stack || error?.message || error);
            }
        },

        onGroupUpdate: async (sock, update, context) => {
            try {
                const db = context.db || getDb();
                
                await handleGroupJoin(sock, update, db);
                await handleLeaveRemoveNickname(sock, update, db);
                
            } catch (error) {
                console.error("❌ خطأ في onGroupUpdate:", error?.stack || error?.message || error);
            }
        }
    };
}

// ============================================================
// Start Bot
// ============================================================

async function main() {
    try {
        console.log("╔════════════════════════════════════╗");
        console.log("║        🤖 ALJESAT BOT START       ║");
        console.log("╚════════════════════════════════════╝");

        const handlers = createHandlers();
        configureHandlers(handlers);

        const sock = await startBot();

        if (!sock) {
            throw new Error("فشل بدء البوت");
        }

        console.log("✅ البوت جاهز لاستقبال الأوامر.");

        return sock;

    } catch (error) {
        console.error("❌ فشل تشغيل ALJESAT BOT:");
        console.error(error?.stack || error?.message || error);
        return null;
    }
}

// ============================================================
// Start
// ============================================================

main().catch(error => {
    console.error("❌ خطأ غير متوقع:", error?.stack || error?.message || error);
});

// ============================================================
// Exports
// ============================================================

module.exports = {
    main
};