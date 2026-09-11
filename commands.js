// ============================================================
// commands.js
// ALJESAT BOT
// Command Router / Economy / Games / Casino (معدل)
// ============================================================

"use strict";

const {
    getDb,
    saveDb,
    cleanNumber,
    jidToNumber,
    getMentionedJid,
    isGroupJid,
    isOwner,
    hasPermission,
    sendText,
    getDailyReward,
    getNextReward,
    getDailyMessage,
    getCooldownMessage,
    getNoNicknameMessage
} = require("./bot");

const {
    activeGames,
    handleGameCommand
} = require("./menu");

const {
    activeCasinos,
    startRoulette,
    startCrystal,
    handleRouletteStart,
    removeCasino,
    isSarahaActive
} = require("./duel");

const {
    handleAdminCommand
} = require("./admin");

const {
    activeSaraha,
    handleSarahaCommand,
    checkSarahaActive,
    stopSarahaGame
} = require("./saraha");

const {
    activeColors,
    handleColorsCommand,
    checkColorsActive,
    stopColorsGame
} = require("./colors");

const {
    activeAnimals,
    handleAnimalsCommand,
    checkAnimalsActive,
    stopAnimalsGame
} = require("./animals");

const {
    activeMazads,
    checkMazadActive,
    handleMazadCommand,
    handleMazadBid,
    handleMazadInventory,
    handleMazadSend,
    handleMazadCancelSend
} = require("./mzad");

// ============================================================
// حالة عامة
// ============================================================

let globalGameBlockUntil = 0;

// ============================================================
// أدوات
// ============================================================

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getMessageText(msg) {
    const message = msg?.message;
    if (!message) return "";

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

function getCommand(text) {
    if (typeof text !== "string" || !text.startsWith(".")) {
        return null;
    }

    const body = text.slice(1).trim();
    if (!body) return null;

    const tokens = body.split(/\s+/);
    const command = String(tokens.shift() || "").toLowerCase();

    return {
        command,
        parts: tokens,
        raw: body
    };
}

// ============================================================
// دعم الأوامر بدون نقطة والأخطاء الإملائية
// ============================================================

function getNormalizedCommand(text) {
    if (!text) return null;
    
    const lower = text.toLowerCase().trim();
    
    // الأوامر التي تبدأ بـ . مباشرة
    if (text.startsWith('.')) return text;
    
    // خريطة الأوامر البديلة (بدون نقطة)
    const commandMap = {
        'القاب': '.القاب',
        'تفاصيل': '.تفاصيلي',
        'تفاصيلي': '.تفاصيلي',
        'تسجيل': '.سجل',
        'تحويل الي': '.تحويل',
        'تحويل': '.تحويل',
        'تنظيم': '.تنظيم'
    };
    
    // التحقق من الأمر الكامل
    for (const [key, value] of Object.entries(commandMap)) {
        if (lower === key || lower.startsWith(key + ' ')) {
            const remaining = lower.slice(key.length);
            return value + remaining;
        }
    }
    
    return null;
}

// ============================================================
// دالة التحقق من تشابه الألقاب
// ============================================================

function isSimilarNickname(existing, newName) {
    // تطبيع النص
    const normalize = (str) => {
        return String(str)
            .replace(/[أإآ]/g, 'ا')
            .replace(/ى/g, 'ي')
            .replace(/ة/g, 'ه')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    };

    const normalizedExisting = normalize(existing);
    const normalizedNew = normalize(newName);

    // نفس الاسم بالضبط
    if (normalizedExisting === normalizedNew) return true;

    // إزالة الأرقام من نهاية الاسم (مثل: ايتاتشي 2)
    const cleanName = (str) => str.replace(/\s*\d+$/, '').trim();
    const cleanExisting = cleanName(normalizedExisting);
    const cleanNew = cleanName(normalizedNew);

    if (cleanExisting === cleanNew) return true;

    // حساب نسبة التشابه
    const minLength = Math.min(cleanExisting.length, cleanNew.length);
    if (minLength < 3) return false;
    
    let matches = 0;
    for (let i = 0; i < minLength; i++) {
        if (cleanExisting[i] === cleanNew[i]) matches++;
    }
    
    const similarity = matches / minLength;
    return similarity > 0.85; // تشابه أكثر من 85%
}

function getSender(msg, sock) {
    if (msg?.key?.fromMe) {
        return sock?.user?.id || "";
    }
    return msg?.key?.participant || msg?.key?.remoteJid || "";
}

function getUser(db, number) {
    if (!db.users) db.users = {};
    return db.users[number] || null;
}

function ensureUser(db, number) {
    db.users = db.users || {};

    if (!db.users[number] || typeof db.users[number] !== "object") {
        db.users[number] = {
            balance: 0,
            nickname: "",
            rank: "",
            maxInteraction: 0,
            friend: ""
        };
    }

    const user = db.users[number];

    if (typeof user.balance !== "number" || !Number.isFinite(user.balance)) {
        user.balance = 0;
    }
    if (typeof user.nickname !== "string") user.nickname = "";
    if (typeof user.rank !== "string") user.rank = "";
    if (typeof user.maxInteraction !== "number" || !Number.isFinite(user.maxInteraction)) {
        user.maxInteraction = 0;
    }
    if (typeof user.friend !== "string") user.friend = "";

    return user;
}

function parsePositiveInteger(value) {
    const amount = Number.parseInt(String(value || "").replace(/[,$]/g, ""), 10);
    if (!Number.isSafeInteger(amount) || amount <= 0) return 0;
    return amount;
}

function findUserByNickname(db, nickname) {
    const wanted = String(nickname || "").trim();
    if (!wanted) return null;

    for (const number of Object.keys(db.users || {})) {
        const user = db.users[number];
        if (user && String(user.nickname || "").trim() === wanted) {
            return { number, user };
        }
    }
    return null;
}

function findUserByNicknameForFriend(db, nickname) {
    const wanted = String(nickname || "").trim();
    if (!wanted) return null;

    for (const number of Object.keys(db.users || {})) {
        const user = db.users[number];
        if (user && String(user.nickname || "").trim() === wanted) {
            return { number, user };
        }
    }
    return null;
}

function userMention(number) {
    const clean = cleanNumber(number);
    return clean ? `${clean}@s.whatsapp.net` : "";
}

// ============================================================
// أوامر الألعاب
// ============================================================

const GAME_COMMANDS = new Set([
    "العاب",
    "كازينو",
    "رهان",
    "بدأ",
    "بدأ_الرهان",
    "بدل_الرهان",
    "تفكيك",
    "كتابة",
    "اعلام",
    "ايموجي",
    "روليت",
    "كريستال",
    "الكرستال",
    "صراحة",
    "الوان",
    "الحيوانات",
    "مزاد",
    "وقف"
]);

function isGameCommand(command) {
    return GAME_COMMANDS.has(command);
}

async function checkGameContext(sock, jid, msg, isGroup) {
    if (!isGroup) {
        await sendText(
            sock,
            jid,
            "يرجى مشاركة الفعالية في مملكة الجاسات ولا يسمح لك باستخدام أو إنشاء فعالية في هذا الشات.",
            msg
        );
        return false;
    }

    if (Date.now() < globalGameBlockUntil) {
        const left = Math.max(1, Math.ceil((globalGameBlockUntil - Date.now()) / 60000));
        await sendText(
            sock,
            jid,
            `⚠️ الفعاليات متوقفة حالياً. يرجى الانتظار ${left} دقيقة.`,
            msg
        );
        return false;
    }

    return true;
}

// ============================================================
// إيقاف كل الألعاب والكازينو
// ============================================================

function stopAllGames() {
    for (const gameJid of Object.keys(activeGames || {})) {
        try {
            const game = activeGames[gameJid];
            if (game && typeof game.stopGame === "function") {
                game.stopGame();
            } else {
                delete activeGames[gameJid];
            }
        } catch (error) {
            console.error(`❌ خطأ أثناء إيقاف اللعبة ${gameJid}:`, error?.message || error);
            delete activeGames[gameJid];
        }
    }
}

function stopAllCasinos() {
    for (const casinoJid of Object.keys(activeCasinos || {})) {
        try {
            removeCasino(casinoJid);
        } catch (_) {
            delete activeCasinos[casinoJid];
        }
    }
}

// ============================================================
// .stop everything
// ============================================================

async function handleEmergencyStop(sock, jid, msg, owner) {
    if (!owner) return true;

    try {
        await sock.sendMessage(jid, { delete: msg.key });
    } catch (_) {}

    globalGameBlockUntil = Date.now() + 15 * 60 * 1000;
    stopAllGames();
    stopAllCasinos();

    for (const jid of Object.keys(activeSaraha || {})) {
        try {
            stopSarahaGame(jid);
        } catch (_) {}
    }

    for (const jid of Object.keys(activeColors || {})) {
        try {
            stopColorsGame(jid);
        } catch (_) {}
    }

    for (const jid of Object.keys(activeAnimals || {})) {
        try {
            stopAnimalsGame(jid);
        } catch (_) {}
    }

    for (const jid of Object.keys(activeMazads || {})) {
        try {
            if (activeMazads[jid] && typeof activeMazads[jid].stopMazad === "function") {
                activeMazads[jid].stopMazad();
            }
        } catch (_) {}
    }

    return true;
}

// ============================================================
// .العاب
// ============================================================

async function handleGamesList(sock, jid, msg) {
    const text = `👑◈═══『 𝐴𝐿𝐽𝐸𝑆𝐴𝑇 亗 511 』═══◈👑
🎮 قـائـمـة الـألـعـاب 🎮
👑◈═══『 𝐴𝐿𝐽𝐸𝑆𝐴𝑇 亗 511 』═══◈👑

🧩 .تفكيك
✍️ .كتابة
😀 .ايموجي
🏳 .اعلام
🎰 .كازينو
🫢 .صراحة
🎨 .الوان
🐾 .الحيوانات

📌 اختر اللعبة التي تريد المشاركة بها

🍀 بالتوفيق للجميع إن شاء الله 💼

⚔️◈═══════════════════◈🫟
          『 𝐴𝐿𝐽𝐸𝑆𝐴𝑇 亗 511 』
🕹️◈══════════════════◈🎮`;

    await sendText(sock, jid, text, msg);
    return true;
}

// ============================================================
// .كازينو
// ============================================================

async function handleCasinoMenu(sock, jid, msg) {
    if (isSarahaActive(jid)) {
        await sendText(sock, jid, "⚠️ لا يمكن فتح الكازينو أثناء وجود لعبة صراحة نشطة.", msg);
        return true;
    }

    const text = `╮─❖『 الكازينو 』❖─╭

🎰 مرحباً بك في الكازينو!

📋 *اختر نوع اللعبة:*

• .روليت - لعبة الدبوس والبالونات 🎈
• .الكرستال - لعبة الكريستال 💎

╰─❖『 اختر ما يناسبك 』❖─╯`;

    await sendText(sock, jid, text, msg);
    return true;
}

// ============================================================
// .القاب (معدل مع التنسيق الجديد)
// ============================================================

async function handleTitles(sock, jid, msg, db) {
    const users = db.users || {};
    const titles = [];
    const mentions = [];

    for (const number of Object.keys(users)) {
        const user = users[number];
        if (user && String(user.nickname || "").trim()) {
            titles.push({ nickname: user.nickname, user: number });
            mentions.push(`${number}@s.whatsapp.net`);
        }
    }

    if (titles.length === 0) {
        await sendText(sock, jid, "⚠️ لا توجد ألقاب مسجلة حالياً.", msg);
        return true;
    }

    let text = "◆━─━─━─⊱🪪⊰─━─━─━◆\n";
    titles.forEach((item, index) => {
        text += `${index + 1} *☜* ${item.nickname}\n`;
    });
    text += "◆━─━─━─⊱📜⊰─━─━─━◆";

    await sendText(sock, jid, text, msg, { mentions });
    return true;
}

// ============================================================
// .سجل (معدل مع منع الألقاب المتشابهة)
// ============================================================

async function handleRegister(sock, jid, msg, parts, senderNumber, owner, db) {
    if (!hasPermission(senderNumber, "2", owner)) {
        await sendText(
            sock,
            jid,
            "❌ ليس لديك صلاحية لاستخدام أمر .سجل (يجب منحها لك عبر .سماح 2).",
            msg
        );
        return true;
    }

    const mentioned = getMentionedJid(msg);
    if (!mentioned) {
        await sendText(sock, jid, "⚠️ يرجى منشن الشخص وكتابة اللقب.", msg);
        return true;
    }

    const target = cleanNumber(mentioned);
    const nickname = parts.slice(1).join(" ").trim();

    if (!nickname) {
        await sendText(sock, jid, "⚠️ يرجى كتابة اللقب بعد المنشن.", msg);
        return true;
    }

    // التحقق من الألقاب المتشابهة
    for (const number of Object.keys(db.users || {})) {
        const existingUser = db.users[number];
        if (!existingUser || !existingUser.nickname) continue;
        
        if (isSimilarNickname(existingUser.nickname, nickname)) {
            await sendText(
                sock,
                jid,
                `⚠️ اللقب \`${nickname}\` مشابه للقب مسجل مسبقاً: \`${existingUser.nickname}\`\n❌ يرجى اختيار لقب مختلف.`,
                msg
            );
            return true;
        }
    }

    const user = ensureUser(db, target);
    user.nickname = nickname;
    saveDb();

    await sendText(
        sock,
        jid,
        `👑◈══════════════◈👑
✅ تم تسجيل لقب العضو بنجاح
🏷️ اللقب الجديد: [${nickname}]

بالتوفيق ان شاء الله 💼
👑◈══════════════◈👑`,
        msg
    );

    return true;
}

// ============================================================
// .حذف
// ============================================================

async function handleDeleteTitle(sock, jid, msg, parts, senderNumber, owner, db) {
    if (!hasPermission(senderNumber, "2", owner)) {
        await sendText(sock, jid, "⚠️ ليس لديك صلاحية لاستخدام هذا الأمر.", msg);
        return true;
    }

    const nickname = parts.join(" ").trim();
    if (!nickname) {
        await sendText(sock, jid, "⚠️ اكتب اللقب المراد حذفه.", msg);
        return true;
    }

    const found = findUserByNickname(db, nickname);
    if (!found) {
        await sendText(sock, jid, `❌ لم يتم العثور على اللقب: [${nickname}]`, msg);
        return true;
    }

    found.user.nickname = "";
    saveDb();

    await sendText(
        sock,
        jid,
        `🚫◈═══『 إزالة لقب 』═══◈🚫
⚠️ تم حذف اللقب بنجاح ✅
🏷️ اللقب المحذوف: [${nickname}]

بواسطة: @${senderNumber}
⛔◈══════════════◈⛔`,
        msg,
        { mentions: [userMention(senderNumber)] }
    );

    return true;
}

// ============================================================
// .علاقة
// ============================================================

async function handleFriendRelation(sock, jid, msg, parts, senderNumber, owner, db, saveDb) {
    if (!hasPermission(senderNumber, "1", owner)) {
        await sendText(
            sock,
            jid,
            "❌ ليس لديك صلاحية لاستخدام أمر .علاقة (يجب منحها لك عبر .سماح 1).",
            msg
        );
        return true;
    }

    const text = getMessageText(msg);
    const match = text.match(/\.علاقة\s+([^\s]+)\s+مع\s+([^\s]+)/);
    
    if (!match) {
        await sendText(
            sock,
            jid,
            "⚠️ الاستخدام الصحيح: .علاقة لقب1 مع لقب2",
            msg
        );
        return true;
    }

    const nickname1 = match[1].trim();
    const nickname2 = match[2].trim();

    if (!nickname1 || !nickname2) {
        await sendText(sock, jid, "⚠️ يرجى تحديد لقبين صحيحين.", msg);
        return true;
    }

    const user1 = findUserByNicknameForFriend(db, nickname1);
    const user2 = findUserByNicknameForFriend(db, nickname2);

    if (!user1) {
        await sendText(sock, jid, `❌ لم يتم العثور على اللقب: [${nickname1}]`, msg);
        return true;
    }

    if (!user2) {
        await sendText(sock, jid, `❌ لم يتم العثور على اللقب: [${nickname2}]`, msg);
        return true;
    }

    if (user1.number === user2.number) {
        await sendText(sock, jid, "⚠️ لا يمكن ربط الشخص بنفسه.", msg);
        return true;
    }

    const u1 = ensureUser(db, user1.number);
    const u2 = ensureUser(db, user2.number);

    u1.friend = nickname2;
    u2.friend = nickname1;

    saveDb();

    try {
        await sock.sendMessage(jid, { delete: msg.key });
    } catch (_) {}

    await sendText(sock, jid, "✅ تم تحديث العلاقة بنجاح.", msg);

    return true;
}

// ============================================================
// .تفاصيلي (معدل مع عرض "غير مسجل")
// ============================================================

async function handleMyDetails(sock, jid, msg, senderNumber, db) {
    const user = getUser(db, senderNumber);

    if (!user || !String(user.nickname || "").trim()) {
        // عرض البيانات مع "غير مسجل"
        const displayNickname = "غير مسجل";
        const friendNickname = String(user?.friend || "").trim() || "لا يوجد";

        const text = `╗═════『   بياناتك  』═════╔

💰 رصـــيـــــــدك:     \`{${user?.balance || 0}}\`

🏷️ لقبك:    \`{${displayNickname}}\`

🎖️ رتبتك:   \`{${user?.rank || "عضو"}}\`

📈 أعلى تفاعل لك: \`{${user?.maxInteraction || 0}}\`

🫂 صـــديق:  \`{${friendNickname}}\`
╝════════════════════╚`;

        await sendText(sock, jid, text, msg);
        return true;
    }

    const friendNickname = String(user.friend || "").trim() || "لا يوجد";

    const text = `╗═════『   بياناتك  』═════╔

💰 رصـــيـــــــدك:     \`{${user.balance || 0}}\`

🏷️ لقبك:    \`{${user.nickname}}\`

🎖️ رتبتك:   \`{${user.rank || "عضو"}}\`

📈 أعلى تفاعل لك: \`{${user.maxInteraction || 0}}\`

🫂 صـــديق:  \`{${friendNickname}}\`
╝════════════════════╚`;

    await sendText(sock, jid, text, msg);
    return true;
}

// ============================================================
// .تفاصيله (معدل مع عرض "غير مسجل")
// ============================================================

async function handleUserDetails(sock, jid, msg, db) {
    const mentioned = getMentionedJid(msg);
    if (!mentioned) {
        await sendText(sock, jid, "⚠️ يرجى منشن الشخص المراد معرفة معلوماته.", msg);
        return true;
    }

    const target = cleanNumber(mentioned);
    const user = getUser(db, target);

    if (!user) {
        await sendText(sock, jid, "❌ العضو المحدد ليس لديه ملف تعريف.", msg);
        return true;
    }

    const displayNickname = String(user.nickname || "").trim() || "غير مسجل";
    const friendNickname = String(user.friend || "").trim() || "لا يوجد";

    const text = `╗═════『 بيانات العضو 』═════╔

👤 العضو: @${target}
💰 رصـــيـــــــده:     \`{${user.balance || 0}}\`

🏷️ لقبه:    \`{${displayNickname}}\`

🎖️ رتبته:   \`{${user.rank || "عضو"}}\`

📈 أعلى تفاعل له: \`{${user.maxInteraction || 0}}\`

🫂 صـــديق:  \`{${friendNickname}}\`
╝════════════════════╚`;

    await sendText(sock, jid, text, msg, { mentions: [mentioned] });
    return true;
}

// ============================================================
// .رتبته
// ============================================================

async function handleRank(sock, jid, msg, parts, senderNumber, owner, db) {
    if (!hasPermission(senderNumber, "3", owner)) {
        await sendText(
            sock,
            jid,
            "❌ ليس لديك صلاحية لاستخدام أمر .رتبته (يجب منحها لك عبر .سماح 3).",
            msg
        );
        return true;
    }

    const mentioned = getMentionedJid(msg);
    if (!mentioned) {
        await sendText(sock, jid, "⚠️ يرجى منشن الشخص وكتابة الرتبة.", msg);
        return true;
    }

    const target = cleanNumber(mentioned);
    const rank = parts.slice(1).join(" ").trim();

    if (!rank) {
        await sendText(sock, jid, "⚠️ يرجى كتابة الرتبة بعد المنشن.", msg);
        return true;
    }

    const user = ensureUser(db, target);
    user.rank = rank;
    saveDb();

    await sendText(sock, jid, `✅ تم تحديث رتبة العضو إلى: [${rank}]`, msg);
    return true;
}

// ============================================================
// .تفاعله
// ============================================================

async function handleInteraction(sock, jid, msg, parts, senderNumber, owner, db) {
    if (!hasPermission(senderNumber, "4", owner)) {
        await sendText(
            sock,
            jid,
            "❌ ليس لديك صلاحية لاستخدام أمر .تفاعله (يجب منحها لك عبر .سماح 4).",
            msg
        );
        return true;
    }

    const mentioned = getMentionedJid(msg);
    if (!mentioned) {
        await sendText(sock, jid, "⚠️ يرجى منشن الشخص وكتابة رقم التفاعل.", msg);
        return true;
    }

    const target = cleanNumber(mentioned);
    const amount = parsePositiveInteger(parts[parts.length - 1]);

    if (!amount) {
        await sendText(sock, jid, "⚠️ يرجى تحديد رقم تفاعل صحيح.", msg);
        return true;
    }

    const user = ensureUser(db, target);
    user.maxInteraction = amount;
    saveDb();

    await sendText(sock, jid, `✅ تم تحديث أعلى تفاعل للعضو إلى: [${amount}]`, msg);
    return true;
}

// ============================================================
// .رصيد
// ============================================================

async function handleDeposit(sock, jid, msg, parts, senderNumber, owner, db) {
    if (!hasPermission(senderNumber, "1", owner)) {
        await sendText(
            sock,
            jid,
            "❌ ليس لديك صلاحية لاستخدام أمر .رصيد (يجب منحها لك عبر .سماح 1).",
            msg
        );
        return true;
    }

    const mentioned = getMentionedJid(msg);
    if (!mentioned) {
        await sendText(sock, jid, "⚠️ يرجى منشن الشخص والمبلغ.", msg);
        return true;
    }

    const target = cleanNumber(mentioned);
    const amount = parsePositiveInteger(parts[parts.length - 1]);

    if (!amount) {
        await sendText(sock, jid, "⚠️ يرجى تحديد مبلغ صحيح للإيداع.", msg);
        return true;
    }

    const user = getUser(db, target);
    if (!user || !String(user.nickname || "").trim()) {
        await sendText(sock, jid, "❌ اللقب غير مسجل عبر أمر .سجل، يرجى تسجيله أولاً.", msg);
        return true;
    }

    user.balance = Number(user.balance || 0) + amount;
    saveDb();

    await sendText(
        sock,
        jid,
        `✅ 『 تم الإيداع 』✅

تم إيداع: \`${amount}\` عملة في البنك للعضو الملقب بـ: [${user.nickname}]`,
        msg
    );

    const bankMessage = `┓━━━✦❘💰❘✦━━━┏
*💰{  ${user.nickname}   }   : رصيدك:* ┊ \`${user.balance}$\`┊
┗━━━✦❘💰❘✦━━━┛`;

    for (const bankJid of Object.keys(db.bankGroups || {})) {
        if (!db.bankGroups[bankJid]) continue;
        await sock.sendMessage(bankJid, { text: bankMessage }).catch(() => {});
    }

    return true;
}

// ============================================================
// .تحويل (معدل لدعم "الى" و "الي")
// ============================================================

async function handleTransfer(sock, jid, msg, parts, senderNumber, db) {
    if (parts[0] && (parts[0].toLowerCase() === 'الى' || parts[0].toLowerCase() === 'الي')) {
        const amount = parsePositiveInteger(parts[parts.length - 1]);
        const targetNickname = parts.slice(1, -1).join(" ").trim();

        if (!targetNickname || !amount) {
            await sendText(sock, jid, "⚠️ الاستخدام الصحيح: .تحويل الى لقب العضو المبلغ", msg);
            return true;
        }

        const senderUser = getUser(db, senderNumber);
        if (!senderUser || !String(senderUser.nickname || "").trim()) {
            await sendText(sock, jid, "❌ يجب أن يكون لديك لقب مسجل عبر .سجل لتتمكن من التحويل.", msg);
            return true;
        }

        const senderBalance = Number(senderUser.balance || 0);
        if (senderBalance < amount) {
            await sendText(
                sock,
                jid,
                `╗════════⛔════════╔
     لا تملك رصيد كافي للتحويل

   رصيدك الحالي: \`${senderBalance}$\`

╝════════🚫════╚`,
                msg
            );
            return true;
        }

        const found = findUserByNickname(db, targetNickname);
        if (!found) {
            await sendText(sock, jid, `❌ لم يتم العثور على عضو مسجل بهذا اللقب: [${targetNickname}]`, msg);
            return true;
        }

        if (found.number === senderNumber) {
            await sendText(sock, jid, "⚠️ لا يمكنك تحويل الرصيد إلى نفسك.", msg);
            return true;
        }

        senderUser.balance = senderBalance - amount;
        found.user.balance = Number(found.user.balance || 0) + amount;
        saveDb();

        await sendText(
            sock,
            jid,
            `👑◈═══『 تحويل فلوس 』═══◈👑
المحول:[${senderUser.nickname}]

المستلم: [${targetNickname}]

المبلغ: [${amount}$]

جار تحويل المبلغ.......💱
👑◈══════════════◈👑`,
            msg
        );

        const receiverBalance = found.user.balance;

        setTimeout(async () => {
            const now = new Date().toLocaleString();
            const bankReceipt = `💰◈═══『 إشعار بنكي 』═══◈💰

🏦 البنك:
✅ تم تحويل رصيد ✅

💰 المبلغ: [${amount}$]

👤 من: [${senderUser.nickname}]

🪪 الى: [${targetNickname}]

📅 التاريخ: [${now}]

💳 الرصيد الحالي للمستلم: [${receiverBalance}$]

💰◈══════════◈🪙`;

            for (const bankJid of Object.keys(db.bankGroups || {})) {
                if (!db.bankGroups[bankJid]) continue;
                await sock.sendMessage(bankJid, { text: bankReceipt }).catch(() => {});
            }
        }, 20000);

        return true;
    }

    return false;
}

// ============================================================
// .هدية - المكافآت اليومية
// ============================================================

async function handleDailyReward(sock, jid, msg, senderNumber, db, saveDb) {
    const user = getUser(db, senderNumber);

    if (!user || !String(user.nickname || "").trim()) {
        await sendText(sock, jid, getNoNicknameMessage(), msg);
        return true;
    }

    const now = Date.now();
    const cooldownTime = 12 * 60 * 60 * 1000;

    db.dailyData = db.dailyData || {};
    if (!db.dailyData[senderNumber]) {
        db.dailyData[senderNumber] = {
            day: 0,
            lastClaim: 0
        };
    }

    const dailyData = db.dailyData[senderNumber];
    const lastClaim = Number(dailyData.lastClaim) || 0;
    const elapsed = now - lastClaim;

    if (lastClaim > 0 && elapsed < cooldownTime) {
        const nextDay = dailyData.day + 1;
        const nextReward = nextDay > 30 ? 10 : getNextReward(dailyData.day);
        const timeLeft = cooldownTime - elapsed;
        await sendText(sock, jid, getCooldownMessage(timeLeft, nextReward), msg);
        return true;
    }

    let currentDay = dailyData.day + 1;

    if (currentDay > 30) {
        currentDay = 1;
    }

    const reward = getDailyReward(currentDay);
    const nextReward = getNextReward(currentDay);

    user.balance = Number(user.balance || 0) + reward;

    dailyData.day = currentDay;
    dailyData.lastClaim = now;
    db.dailyCooldown = db.dailyCooldown || {};
    db.dailyCooldown[senderNumber] = now;

    saveDb();

    const message = getDailyMessage(currentDay, reward, nextReward);
    await sendText(sock, jid, message, msg);

    return true;
}

// ============================================================
// .اذن @user - منح صلاحية السلسلة
// ============================================================

async function handleGrantPermission(sock, jid, msg, parts, senderNumber, owner, db, saveDb) {
    if (!owner) {
        await sendText(sock, jid, "⚠️ هذا الأمر للمطور فقط.", msg);
        return true;
    }

    const mentioned = getMentionedJid(msg);
    if (!mentioned) {
        await sendText(sock, jid, "⚠️ يرجى منشن الشخص المطلوب.", msg);
        return true;
    }

    const target = cleanNumber(mentioned);

    db.chainPermissions = db.chainPermissions || [];

    if (!db.chainPermissions.includes(target)) {
        db.chainPermissions.push(target);
        saveDb();
        await sendText(sock, jid, `✅ تم منح صلاحية السلسلة للعضو @${target}`, msg, { mentions: [mentioned] });
    } else {
        await sendText(sock, jid, `⚠️ العضو @${target} لديه الصلاحية بالفعل.`, msg, { mentions: [mentioned] });
    }

    return true;
}

// ============================================================
// .سلسلة @user عدد - تعديل أيام السلسلة
// ============================================================

async function handleChainEdit(sock, jid, msg, parts, senderNumber, owner, db, saveDb) {
    db.chainPermissions = db.chainPermissions || [];
    const hasPermission = owner || db.chainPermissions.includes(senderNumber);

    if (!hasPermission) {
        await sendText(sock, jid, "⚠️ ليس لديك صلاحية لتعديل سلسلة الأيام.", msg);
        return true;
    }

    const mentioned = getMentionedJid(msg);
    if (!mentioned) {
        await sendText(sock, jid, "⚠️ يرجى منشن الشخص وكتابة عدد الأيام.", msg);
        return true;
    }

    const target = cleanNumber(mentioned);
    const dayCount = parsePositiveInteger(parts[parts.length - 1]);

    if (!dayCount || dayCount < 1 || dayCount > 30) {
        await sendText(sock, jid, "⚠️ يرجى تحديد عدد أيام صحيح (1-30).", msg);
        return true;
    }

    db.dailyData = db.dailyData || {};
    if (!db.dailyData[target]) {
        db.dailyData[target] = {
            day: 0,
            lastClaim: 0
        };
    }

    db.dailyData[target].day = dayCount;
    saveDb();

    await sendText(sock, jid, `✅ تم تعديل سلسلة العضو @${target} إلى ${dayCount} أيام.`, msg, { mentions: [mentioned] });

    return true;
}

// ============================================================
// .رهان
// ============================================================

async function handleRouletteBet(sock, jid, msg, parts, senderNumber, db) {
    const casino = activeCasinos[jid];

    if (!casino || casino.started || casino.type !== "roulette") {
        await sendText(
            sock,
            jid,
            "⚠️ لا توجد فعالية روليت مفتوحة لاستقبال الرهانات حالياً. اكتب .روليت لإنشائها.",
            msg
        );
        return true;
    }

    if (casino.bets && casino.bets[senderNumber]) {
        await sendText(sock, jid, "⚠️ لا يمكنك وضع رهان لأنك وضعت رهان بالفعل!", msg);
        return true;
    }

    const user = getUser(db, senderNumber);
    if (!user || !String(user.nickname || "").trim()) {
        await sendText(sock, jid, "❌ يجب تسجيل لقبك أولاً عبر أمر .سجل لتتمكن من المراهنة.", msg);
        return true;
    }

    const amount = parsePositiveInteger(parts[0]);
    if (!amount) {
        await sendText(sock, jid, "⚠️ يرجى تحديد مبلغ صحيح للرهان، مثل: .رهان 100", msg);
        return true;
    }

    const balance = Number(user.balance || 0);
    if (balance < amount) {
        await sendText(
            sock,
            jid,
            `╗════════⛔════════╔
     لا تملك رصيد كافي للرهان

   رصيدك الحالي: \`${balance}$\`

╝════════🚫════╚`,
            msg
        );
        return true;
    }

    const players = Object.keys(casino.bets || {});
    if (players.length >= 8) {
        await sendText(sock, jid, "⚠️ عذراً، اكتمل العدد الأقصى للمشاركين (8 مقاعد).", msg);
        return true;
    }

    const firstPlayer = players[0];
    if (firstPlayer) {
        const firstAmount = Number(casino.bets[firstPlayer]?.amount) || 0;
        if (amount < firstAmount) {
            await sendText(
                sock,
                jid,
                `⚠️ يجب أن يكون الرهان مساوياً أو أعلى من أول رهان (${firstAmount}$)`,
                msg
            );
            return true;
        }
    }

    casino.bets = casino.bets || {};
    casino.bets[senderNumber] = {
        nickname: user.nickname,
        amount,
        lives: 4,
        jid: userMention(senderNumber)
    };

    await sendText(sock, jid, `✅ تم وضع الرهان من قبل [${user.nickname}] ✅`, msg);
    return true;
}

// ============================================================
// .ايقاف
// ============================================================

async function handleGamePause(sock, jid, msg, senderNumber, owner, db) {
    const hasPerm = owner || hasPermission(senderNumber, "1", owner);
    if (!hasPerm) {
        await sendText(sock, jid, "⚠️ ليس لديك صلاحية لإيقاف الفعاليات.", msg);
        return true;
    }

    const game = activeGames[jid];

    if (game && !game.gameEnded) {
        game.gameEnded = true;
        game.isPaused = true;

        if (typeof game.stopGame === "function") {
            try {
                game.stopGame();
            } catch (_) {}
        }

        await sendText(sock, jid, "⏸️ تم إيقاف الفعالية الحالية مؤقتاً. استخدم .كمل لاستئنافها.", msg);
        return true;
    }

    await sendText(sock, jid, "⚠️ لا توجد فعالية جارية حالياً لإيقافها.", msg);
    return true;
}

// ============================================================
// .كمل
// ============================================================

async function handleGameResume(sock, jid, msg, senderNumber, owner) {
    const game = activeGames[jid];

    if (game && game.isPaused) {
        game.isPaused = false;
        game.gameEnded = false;

        if (typeof game.sendNewChallenge === "function") {
            await sendText(sock, jid, "▶️ تم استئناف الفعالية بنجاح، تابعوا اللعب!", msg);
            await game.sendNewChallenge();
        } else {
            await sendText(sock, jid, "⚠️ لا يمكن استئناف هذه الفعالية.", msg);
        }

        return true;
    }

    if (game && !game.gameEnded) {
        await sendText(sock, jid, "⚠️ الفعالية قيد التشغيل بالفعل.", msg);
        return true;
    }

    await sendText(sock, jid, "⚠️ لا توجد فعالية متوقفة حالياً لاستكمالها.", msg);
    return true;
}

// ============================================================
// .وقف - إيقاف كل الألعاب
// ============================================================

async function handleStopAllGames(sock, jid, msg, senderNumber, owner, db) {
    db.gamePermissions = Array.isArray(db.gamePermissions) ? db.gamePermissions : [];
    const hasPerm = owner || db.gamePermissions.includes(senderNumber);
    
    if (!hasPerm) {
        await sendText(sock, jid, "⚠️ ليس لديك صلاحية لاستخدام هذا الأمر.", msg);
        return true;
    }

    stopAllGames();
    stopAllCasinos();

    for (const gJid of Object.keys(activeSaraha || {})) {
        try {
            stopSarahaGame(gJid);
        } catch (_) {}
    }

    for (const gJid of Object.keys(activeColors || {})) {
        try {
            stopColorsGame(gJid);
        } catch (_) {}
    }

    for (const gJid of Object.keys(activeAnimals || {})) {
        try {
            stopAnimalsGame(gJid);
        } catch (_) {}
    }

    for (const mJid of Object.keys(activeMazads || {})) {
        try {
            if (activeMazads[mJid] && typeof activeMazads[mJid].stopMazad === "function") {
                activeMazads[mJid].stopMazad();
            }
        } catch (_) {}
    }

    try {
        for (const key of Object.keys(activeGames)) {
            delete activeGames[key];
        }
        for (const key of Object.keys(activeCasinos)) {
            delete activeCasinos[key];
        }
    } catch (_) {}

    await sendText(
        sock,
        jid,
        `◆⫘⫘⫘⫘🔑⫘⫘⫘⫘◆
   تم ايقاف كل الالعاب والكازينو
◆⫘⫘⫘⫘🔒⫘⫘⫘⫘◆`,
        msg
    );

    return true;
}

// ============================================================
// .ردود on/off
// ============================================================

async function handleReplies(sock, jid, msg, parts, senderNumber, owner, db, saveDb) {
    db.gamePermissions = Array.isArray(db.gamePermissions) ? db.gamePermissions : [];
    const hasPerm = owner || db.gamePermissions.includes(senderNumber);

    if (!hasPerm) {
        await sendText(sock, jid, "⚠️ ليس لديك صلاحية لاستخدام هذا الأمر.", msg);
        return true;
    }

    const action = String(parts[0] || "").toLowerCase();
    db.repliesEnabled = db.repliesEnabled || {};

    if (action === "on") {
        db.repliesEnabled[jid] = true;
        saveDb();
        try {
            await sock.sendMessage(jid, { delete: msg.key });
        } catch (_) {}
        await sendText(sock, jid, "✅ تم تشغيل الردود.", msg);
    } else if (action === "off") {
        delete db.repliesEnabled[jid];
        saveDb();
        try {
            await sock.sendMessage(jid, { delete: msg.key });
        } catch (_) {}
        await sendText(sock, jid, "✅ تم إيقاف الردود.", msg);
    } else {
        await sendText(sock, jid, "⚠️ الاستخدام الصحيح: .ردود on/off", msg);
    }

    return true;
}

// ============================================================
// .احا on/off
// ============================================================

async function handleAha(sock, jid, msg, parts, senderNumber, owner, db, saveDb) {
    db.gamePermissions = Array.isArray(db.gamePermissions) ? db.gamePermissions : [];
    const hasPerm = owner || db.gamePermissions.includes(senderNumber);

    if (!hasPerm) {
        await sendText(sock, jid, "⚠️ ليس لديك صلاحية لاستخدام هذا الأمر.", msg);
        return true;
    }

    const action = String(parts[0] || "").toLowerCase();
    db.ahaEnabled = db.ahaEnabled || {};

    if (action === "on") {
        db.ahaEnabled[jid] = true;
        saveDb();
        try {
            await sock.sendMessage(jid, { delete: msg.key });
        } catch (_) {}
        await sendText(sock, jid, "✅ تم تشغيل أمر احا.", msg);
    } else if (action === "off") {
        delete db.ahaEnabled[jid];
        saveDb();
        try {
            await sock.sendMessage(jid, { delete: msg.key });
        } catch (_) {}
        await sendText(sock, jid, "✅ تم إيقاف أمر احا.", msg);
    } else {
        await sendText(sock, jid, "⚠️ الاستخدام الصحيح: .احا on/off", msg);
    }

    return true;
}

// ============================================================
// .هدوء on/off
// ============================================================

async function handleQuiet(sock, jid, msg, parts, senderNumber, owner, db, saveDb) {
    db.gamePermissions = Array.isArray(db.gamePermissions) ? db.gamePermissions : [];
    const hasPerm = owner || db.gamePermissions.includes(senderNumber);

    if (!hasPerm) {
        await sendText(sock, jid, "⚠️ ليس لديك صلاحية لاستخدام هذا الأمر.", msg);
        return true;
    }

    const action = String(parts[0] || "").toLowerCase();
    db.quietEnabled = db.quietEnabled || {};

    if (action === "on") {
        db.quietEnabled[jid] = true;
        db.quietTimer = db.quietTimer || {};
        db.quietTimer[jid] = {
            lastMessageTime: Date.now(),
            sent: false,
            interval: null
        };

        if (db.quietTimer[jid].interval) {
            clearInterval(db.quietTimer[jid].interval);
        }

        db.quietTimer[jid].interval = setInterval(async () => {
            const timer = db.quietTimer[jid];
            if (!timer) return;

            const now = Date.now();
            const elapsed = now - timer.lastMessageTime;

            if (elapsed > 10 * 60 * 1000 && !timer.sent) {
                timer.sent = true;
                try {
                    await sock.sendMessage(jid, {
                        text: `😶‍🌫️══════════════😶‍🌫️
عمّ الهدوء في قروب المغوليين
😶‍🌫️══════════════😶‍🌫️`
                    });
                    await sock.sendMessage(jid, {
                        react: { text: "😶‍🌫️", key: msg.key }
                    }).catch(() => {});
                } catch (_) {}
            }

            const currentElapsed = now - timer.lastMessageTime;
            if (currentElapsed < 10 * 60 * 1000 && timer.sent) {
                timer.sent = false;
            }
        }, 60000);

        saveDb();
        try {
            await sock.sendMessage(jid, { delete: msg.key });
        } catch (_) {}
        await sendText(sock, jid, "✅ تم تشغيل وضع الهدوء.", msg);
    } else if (action === "off") {
        delete db.quietEnabled[jid];
        if (db.quietTimer && db.quietTimer[jid] && db.quietTimer[jid].interval) {
            clearInterval(db.quietTimer[jid].interval);
        }
        delete db.quietTimer[jid];
        saveDb();
        try {
            await sock.sendMessage(jid, { delete: msg.key });
        } catch (_) {}
        await sendText(sock, jid, "✅ تم إيقاف وضع الهدوء.", msg);
    } else {
        await sendText(sock, jid, "⚠️ الاستخدام الصحيح: .هدوء on/off", msg);
    }

    return true;
}

// ============================================================
// .تنظيم on/off - تفعيل مراقبة المغادرين
// ============================================================

async function handleOrganize(sock, jid, msg, parts, senderNumber, owner, db, saveDb) {
    if (!owner) {
        await sendText(sock, jid, "⚠️ هذا الأمر للمطور فقط.", msg);
        return true;
    }

    const action = String(parts[0] || "").toLowerCase();
    db.organizedGroups = db.organizedGroups || {};

    if (action === "on") {
        db.organizedGroups[jid] = true;
        saveDb();
        await sendText(sock, jid, "✅ تم تفعيل مراقبة المغادرين في هذا القروب.\nسيتم حذف لقب أي عضو يغادر تلقائياً.", msg);
    } else if (action === "off") {
        delete db.organizedGroups[jid];
        saveDb();
        await sendText(sock, jid, "❌ تم إيقاف مراقبة المغادرين في هذا القروب.", msg);
    } else {
        await sendText(sock, jid, "⚠️ الاستخدام الصحيح: .تنظيم on/off", msg);
    }

    return true;
}

// ============================================================
// الراوتر الرئيسي (معدل لدعم الأوامر بدون نقطة)
// ============================================================

async function handleCommand(sock, jid, msg, context = {}) {
    const db = context.db || getDb();
    const text = context.text || getMessageText(msg);
    
    // ============================================================
    // معالجة الأوامر بدون نقطة
    // ============================================================
    const normalizedCommand = getNormalizedCommand(text);
    let finalText = text;
    let isNormalized = false;
    
    if (normalizedCommand && normalizedCommand !== text) {
        finalText = normalizedCommand;
        isNormalized = true;
    }
    
    const parsed = getCommand(finalText);
    if (!parsed) {
        if (isNormalized) {
            return false;
        }
        return false;
    }

    const { command, parts } = parsed;

    const sender = context.sender || getSender(msg, sock);
    const senderNumber = context.cleanSender || cleanNumber(jidToNumber(sender));
    const group = context.isGroup ?? isGroupJid(jid);
    const owner = context.isBotOwner ?? isOwner(senderNumber, sock, msg);

    // ========================================================
    // STOP EVERYTHING
    // ========================================================

    if (finalText.trim().toLowerCase() === ".stop everything") {
        return handleEmergencyStop(sock, jid, msg, owner);
    }

    // ========================================================
    // الأوامر التي تحتاج مجموعة
    // ========================================================

    if (isGameCommand(command) ||
        command === "بوت" ||
        command === "استقبال" ||
        command === "ورك" ||
        command === "work" ||
        command === "طرف" ||
        command === "سحب") {

        if (!group) {
            await sendText(
                sock,
                jid,
                "يرجى مشاركة الفعالية في مملكة الجاسات ولا يسمح لك باستخدام أو إنشاء فعالية في هذا الشات.",
                msg
            );
            return true;
        }

        if (isGameCommand(command) && !await checkGameContext(sock, jid, msg, group)) {
            return true;
        }
    }

    // ========================================================
    // الإدارة
    // ========================================================

    const adminCommands = new Set([
        "سماح",
        "صلاحيات",
        "بوت",
        "استقبال",
        "ورك",
        "work",
        "طرف",
        "سحب"
    ]);

    if (adminCommands.has(command)) {
        const handled = await handleAdminCommand(
            sock,
            jid,
            msg,
            command,
            parts,
            senderNumber,
            sender,
            db,
            saveDb,
            owner,
            group,
            (user, level) => hasPermission(user, level, owner)
        );
        return handled !== false;
    }

    // ========================================================
    // الإعلانات
    // ========================================================

    if (command === "ads") {
        if (!owner) return true;

        const action = String(parts[0] || "").toLowerCase();
        db.adsGroups = db.adsGroups || {};

        if (action === "on") {
            db.adsGroups[jid] = true;
            saveDb();
            await sendText(sock, jid, "✅ تم تفعيل الإعلانات في هذا القروب.", msg);
        } else if (action === "off") {
            delete db.adsGroups[jid];
            saveDb();
            await sendText(sock, jid, "❌ تم إيقاف الإعلانات في هذا القروب.", msg);
        } else {
            await sendText(sock, jid, "⚠️ الاستخدام الصحيح: .ads on/off", msg);
        }

        return true;
    }

    // ========================================================
    // البنك
    // ========================================================

    if (command === "البنك") {
        if (!owner) return true;

        const action = String(parts[0] || "").toLowerCase();
        db.bankGroups = db.bankGroups || {};

        if (action === "on") {
            db.bankGroups[jid] = true;
            saveDb();
            await sendText(
                sock,
                jid,
                "╗════════✅════════╔\n  تم حفظ هذا القروب بأسم البنك \n╝════════✅════╚",
                msg
            );
        } else if (action === "off") {
            delete db.bankGroups[jid];
            saveDb();
            await sendText(
                sock,
                jid,
                "╗════════⛔════════╔\n  تم ايقاف حفظ هذا القروب بأسم البنك \n╝════════🚫════╚",
                msg
            );
        } else {
            await sendText(sock, jid, "⚠️ الاستخدام الصحيح: .البنك on/off", msg);
        }

        return true;
    }

    // ========================================================
    // .تنظيم
    // ========================================================

    if (command === "تنظيم") {
        return handleOrganize(sock, jid, msg, parts, senderNumber, owner, db, saveDb);
    }

    // ========================================================
    // الألعاب
    // ========================================================

    if (command === "العاب") {
        return handleGamesList(sock, jid, msg);
    }

    if (command === "تفكيك" || command === "كتابة" || command === "اعلام" || command === "ايموجي") {
        await handleGameCommand(
            sock,
            jid,
            msg,
            command,
            senderNumber,
            sender,
            db,
            saveDb,
            owner
        );
        return true;
    }

    // ========================================================
    // الكازينو
    // ========================================================

    if (command === "كازينو") {
        return handleCasinoMenu(sock, jid, msg);
    }

    if (command === "روليت") {
        await startRoulette(sock, jid, msg, senderNumber, sender, db, saveDb, owner);
        return true;
    }

    if (command === "الكرستال" || command === "كريستال") {
        await startCrystal(sock, jid, msg, senderNumber, sender, db, saveDb, owner, parts);
        return true;
    }

    if (command === "رهان") {
        return handleRouletteBet(sock, jid, msg, parts, senderNumber, db);
    }

    if (command === "بدأ" || command === "بدأ_الرهان" || command === "بدل_الرهان") {
        if (command === "بدأ" && parts[0]?.toLowerCase() !== "الرهان" && !activeCasinos[jid]) {
            return false;
        }
        return handleRouletteStart(sock, jid, msg, senderNumber, owner, db);
    }

    if (command === "انسحاب") {
        const casino = activeCasinos[jid];
        if (!casino) {
            await sendText(sock, jid, "⚠️ لا يوجد كازينو نشط لإلغائه.", msg);
            return true;
        }

        if (casino.creator !== senderNumber && !owner) {
            await sendText(sock, jid, "⚠️ منشئ الفعالية فقط أو المطور يمكنه إلغاؤها بـ .انسحاب", msg);
            return true;
        }

        try {
            if (typeof casino.stopGame === "function") {
                casino.stopGame();
            }
        } catch (_) {}

        delete activeCasinos[jid];
        await sendText(sock, jid, "🚫 تم إلغاء فعالية الكازينو بنجاح.", msg);
        return true;
    }

    // ========================================================
    // .ايقاف و .كمل
    // ========================================================

    if (command === "ايقاف") {
        return handleGamePause(sock, jid, msg, senderNumber, owner, db);
    }

    if (command === "كمل") {
        return handleGameResume(sock, jid, msg, senderNumber, owner);
    }

    // ========================================================
    // .وقف
    // ========================================================

    if (command === "وقف") {
        return handleStopAllGames(sock, jid, msg, senderNumber, owner, db);
    }

    // ========================================================
    // .القاب
    // ========================================================

    if (command === "القاب") {
        return handleTitles(sock, jid, msg, db);
    }

    // ========================================================
    // .سجل
    // ========================================================

    if (command === "سجل") {
        return handleRegister(sock, jid, msg, parts, senderNumber, owner, db);
    }

    // ========================================================
    // .حذف
    // ========================================================

    if (command === "حذف") {
        return handleDeleteTitle(sock, jid, msg, parts, senderNumber, owner, db);
    }

    // ========================================================
    // .علاقة
    // ========================================================

    if (command === "علاقة") {
        return handleFriendRelation(sock, jid, msg, parts, senderNumber, owner, db, saveDb);
    }

    // ========================================================
    // .رتبته
    // ========================================================

    if (command === "رتبته") {
        return handleRank(sock, jid, msg, parts, senderNumber, owner, db);
    }

    // ========================================================
    // .تفاعله
    // ========================================================

    if (command === "تفاعله") {
        return handleInteraction(sock, jid, msg, parts, senderNumber, owner, db);
    }

    // ========================================================
    // .تفاصيلي و .تفاصيله
    // ========================================================

    if (command === "تفاصيلي") {
        return handleMyDetails(sock, jid, msg, senderNumber, db);
    }

    if (command === "تفاصيله") {
        return handleUserDetails(sock, jid, msg, db);
    }

    // ========================================================
    // .رصيد
    // ========================================================

    if (command === "رصيد") {
        return handleDeposit(sock, jid, msg, parts, senderNumber, owner, db);
    }

    // ========================================================
    // .تحويل
    // ========================================================

    if (command === "تحويل") {
        return handleTransfer(sock, jid, msg, parts, senderNumber, db);
    }

    // ========================================================
    // .المطور
    // ========================================================

    if (command === "المطور") {
        await sendText(sock, jid, "👨‍💻 أهلاً بك، البوت يعمل بكامل نظامه وجاهز للفعاليات!", msg);
        return true;
    }

    // ========================================================
    // .هدية
    // ========================================================

    if (command === "هدية") {
        return handleDailyReward(sock, jid, msg, senderNumber, db, saveDb);
    }

    // ========================================================
    // .اذن
    // ========================================================

    if (command === "اذن") {
        return handleGrantPermission(sock, jid, msg, parts, senderNumber, owner, db, saveDb);
    }

    // ========================================================
    // .سلسلة
    // ========================================================

    if (command === "سلسلة") {
        return handleChainEdit(sock, jid, msg, parts, senderNumber, owner, db, saveDb);
    }

    // ========================================================
    // .ردود
    // ========================================================

    if (command === "ردود") {
        return handleReplies(sock, jid, msg, parts, senderNumber, owner, db, saveDb);
    }

    // ========================================================
    // .احا
    // ========================================================

    if (command === "احا") {
        return handleAha(sock, jid, msg, parts, senderNumber, owner, db, saveDb);
    }

    // ========================================================
    // .هدوء
    // ========================================================

    if (command === "هدوء") {
        return handleQuiet(sock, jid, msg, parts, senderNumber, owner, db, saveDb);
    }

    // ========================================================
    // أوامر المزاد - تعالج في index.js
    // ========================================================

    return false;
}

// ============================================================
// التحكم بالحظر العام
// ============================================================

function getGlobalGameBlockUntil() {
    return globalGameBlockUntil;
}

function setGlobalGameBlockUntil(timestamp) {
    globalGameBlockUntil = Number(timestamp) || 0;
}

function isGamesBlocked() {
    return Date.now() < globalGameBlockUntil;
}

// ============================================================
// exports
// ============================================================

module.exports = {
    handleCommand,
    getMessageText,
    getCommand,
    isGameCommand,
    stopAllGames,
    stopAllCasinos,
    getGlobalGameBlockUntil,
    setGlobalGameBlockUntil,
    isGamesBlocked,
    findUserByNickname,
    findUserByNicknameForFriend,
    isSimilarNickname,
    getNormalizedCommand
};