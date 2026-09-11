// admin.js
// ============================================================
// أوامر الإدارة والصلاحيات ومراقبة الإشراف
// ============================================================

"use strict";

const { messages } = require("./data");

// ============================================================
// حالة مراقبة الإشراف
// ============================================================

let adminMonitorInterval = null;
let isMonitoringActive = false;

// ============================================================
// أدوات مساعدة
// ============================================================

function cleanNumber(value) {
    if (!value) return "";
    return String(value).replace(/[^0-9]/g, "");
}

function getMentionedJid(msg) {
    try {
        return msg?.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] ||
            msg?.message?.contextInfo?.mentionedJid?.[0] ||
            null;
    } catch {
        return null;
    }
}

function isAdmin(participant) {
    return Boolean(
        participant &&
        (
            participant.admin === "admin" ||
            participant.admin === "superadmin"
        )
    );
}

async function send(sock, jid, text, msg = null, extra = {}) {
    if (!sock || !jid) return null;

    try {
        return await sock.sendMessage(
            jid,
            {
                text: String(text || ""),
                ...extra
            },
            msg ? { quoted: msg } : {}
        );
    } catch (error) {
        console.error("❌ فشل إرسال الرسالة:", error?.message || error);
        return null;
    }
}

function ensurePermissions(db) {
    if (!db.permissions || typeof db.permissions !== "object") {
        db.permissions = {};
    }

    for (const type of ["1", "2", "3", "4"]) {
        if (!Array.isArray(db.permissions[type])) {
            db.permissions[type] = [];
        }
    }

    return db.permissions;
}

function hasPermission(db, user, type) {
    const permissions = ensurePermissions(db);
    return permissions[type]?.includes(cleanNumber(user)) || false;
}

// ============================================================
// الحصول على أرقام المشرفين الحاليين
// ============================================================

function getCurrentAdmins(participants) {
    return participants
        .filter(isAdmin)
        .map((participant) => {
            const id = participant.id || "";
            return cleanNumber(id.split("@")[0] || id);
        })
        .filter(Boolean);
}

// ============================================================
// الحصول على منفذ العملية من الحدث
// ============================================================

function getActorFromUpdate(update) {
    try {
        if (update?.author) {
            return cleanNumber(update.author.split("@")[0] || update.author);
        }

        if (update?.actor) {
            return cleanNumber(update.actor.split("@")[0] || update.actor);
        }

        return null;
    } catch {
        return null;
    }
}

// ============================================================
// مراقبة الإشراف - نظام الحماية الفوري
// ============================================================

function startAdminMonitoring(sock, db, saveDb) {
    stopAdminMonitoring();

    if (!sock || !sock.groupMetadata) {
        console.warn("⚠️ لا يمكن بدء مراقبة الإشراف: socket غير صالح");
        return null;
    }

    isMonitoringActive = true;

    const groupUpdateHandler = async (update) => {
        try {
            if (!isMonitoringActive) return;

            const { id, participants, action } = update || {};

            if (!id) return;
            if (action !== "demote") return;
            if (!Array.isArray(participants) || participants.length === 0) return;

            const monitoredGroups = db.monitoredUsers || {};
            const monitoredNumbers = Array.isArray(monitoredGroups[id])
                ? monitoredGroups[id]
                : [];

            if (monitoredNumbers.length === 0) return;

            const metadata = await sock.groupMetadata(id).catch(() => null);
            if (!metadata) return;

            const allParticipants = Array.isArray(metadata.participants)
                ? metadata.participants
                : [];

            const currentAdmins = getCurrentAdmins(allParticipants);

            const lostAdmin = monitoredNumbers.find(
                (number) => !currentAdmins.includes(cleanNumber(number))
            );

            if (!lostAdmin) return;

            const actor = getActorFromUpdate(update);

            if (!actor) {
                console.warn(`⚠️ تعذر تحديد منفذ العملية في ${id}`);
                return;
            }

            const botId = sock?.user?.id || "";
            const botNumber = cleanNumber(botId.split("@")[0] || botId);

            const botParticipant = allParticipants.find(
                (participant) => {
                    const id = participant.id || "";
                    return cleanNumber(id.split("@")[0] || id) === botNumber;
                }
            );

            if (!isAdmin(botParticipant)) {
                console.warn(`⚠️ البوت ليس مشرفاً في ${id}`);
                return;
            }

            if (actor === botNumber) return;
            if (actor === lostAdmin) return;

            try {
                const actorJid = `${cleanNumber(actor)}@s.whatsapp.net`;
                const lostAdminJid = `${cleanNumber(lostAdmin)}@s.whatsapp.net`;

                await sock.groupParticipantsUpdate(id, [actorJid], "demote");
                await sock.groupParticipantsUpdate(id, [lostAdminJid], "promote");

                const adminMentions = currentAdmins.map(
                    (number) => `${cleanNumber(number)}@s.whatsapp.net`
                );

                const warningMsg = `⚠️⛔━━━━━━━━━━━━━━━━⛔⚠️
🚨 تـنـبـيـه هـام 🚨
⚠️⛔━━━━━━━━━━━━━━━━⛔⚠️

❌ تم رصد محاولة سحب إشراف العضو المحمي:

👤 المخالف: @${cleanNumber(actor)}

🛡️ العضو المحمي:
@${cleanNumber(lostAdmin)}

🚫 ممنوع سحب الإشراف من هذا الرقم.
تمت إعادة الإشراف إليه تلقائياً.

⚠️ تم اتخاذ الإجراء بحق المخالف.

📢 تنبيه جميع مشرفي المجموعة:
${adminMentions.map(m => `@${cleanNumber(m)}`).join(' ')}

⚠️⛔━━━━━━━━━━━━━━━━⛔⚠️`;

                await sock.sendMessage(id, {
                    text: warningMsg,
                    mentions: [...adminMentions, actorJid, lostAdminJid]
                });

                console.log(
                    `✅ تم سحب إشراف ${actor} وإعادة إشراف ${lostAdmin} في ${id}`
                );

                if (typeof saveDb === "function") {
                    saveDb();
                }

            } catch (error) {
                console.error("❌ خطأ في معالجة سحب الإشراف:", error?.message || error);
            }

        } catch (error) {
            console.error("❌ خطأ في groupUpdateHandler:", error?.message || error);
        }
    };

    if (!sock._adminMonitorRegistered) {
        sock.ev.on("group-participants.update", groupUpdateHandler);
        sock._adminMonitorRegistered = true;
        console.log("✅ تم تسجيل مستمع الحماية الفوري");
    }

    return groupUpdateHandler;
}

// ============================================================
// إيقاف مراقبة الإدارة
// ============================================================

function stopAdminMonitoring() {
    isMonitoringActive = false;

    if (adminMonitorInterval) {
        clearInterval(adminMonitorInterval);
        adminMonitorInterval = null;
    }

    console.log("🛑 تم إيقاف مراقبة الإشراف");
}

// ============================================================
// معالجة أوامر الإدارة
// ============================================================

async function handleAdminCommand(
    sock,
    jid,
    msg,
    command,
    parts,
    cleanSender,
    sender,
    db,
    saveDb,
    isBotOwner,
    isGroup,
    permissionChecker
) {
    const userNumber = cleanNumber(cleanSender);

    const canUse = (type) => {
        if (isBotOwner) return true;

        if (typeof permissionChecker === "function") {
            try {
                return Boolean(permissionChecker(userNumber, type));
            } catch {
                return hasPermission(db, userNumber, type);
            }
        }

        return hasPermission(db, userNumber, type);
    };

    // ========================================================
    // .سماح
    // ========================================================

    if (command === "سماح") {
        if (!isBotOwner) {
            await send(sock, jid, messages.admin.onlyBotOwner, msg);
            return true;
        }

        const permissionType = String(parts?.[0] || "");
        const mentioned = getMentionedJid(msg);

        if (!["1", "2", "3", "4"].includes(permissionType) || !mentioned) {
            await send(
                sock,
                jid,
                messages.admin.invalidUsage(".سماح", "[1/2/3/4] @user"),
                msg
            );
            return true;
        }

        const target = cleanNumber(mentioned);
        const permissions = ensurePermissions(db);

        if (!permissions[permissionType].includes(target)) {
            permissions[permissionType].push(target);
            if (typeof saveDb === "function") saveDb();
        }

        const commandNames = {
            "1": ".رصيد",
            "2": ".سجل",
            "3": ".رتبته",
            "4": ".تفاعله"
        };

        await send(
            sock,
            jid,
            messages.admin.permissions.granted(commandNames[permissionType], target),
            msg,
            { mentions: [mentioned] }
        );

        return true;
    }

    // ========================================================
    // .صلاحيات - فقط لرقم البوت
    // ========================================================

    if (command === "صلاحيات") {
        const botId = sock?.user?.id || "";
        const botNumber = cleanNumber(botId.split("@")[0] || botId);

        const senderClean = cleanNumber(sender);
        if (senderClean !== botNumber) {
            await send(sock, jid, "⚠️ هذا الأمر مخصص فقط لرقم البوت.", msg);
            return true;
        }

        const mentioned = getMentionedJid(msg);
        if (!mentioned) {
            await send(sock, jid, messages.admin.invalidUsage(".صلاحيات", "@user"), msg);
            return true;
        }

        const target = cleanNumber(mentioned);
        db.gamePermissions = Array.isArray(db.gamePermissions) ? db.gamePermissions : [];
        const index = db.gamePermissions.indexOf(target);

        if (index === -1) {
            db.gamePermissions.push(target);
            if (typeof saveDb === "function") saveDb();
            await send(sock, jid, messages.admin.gamePerms.granted(target), msg, { mentions: [mentioned] });
        } else {
            db.gamePermissions.splice(index, 1);
            if (typeof saveDb === "function") saveDb();
            await send(sock, jid, messages.admin.gamePerms.revoked(target), msg, { mentions: [mentioned] });
        }

        return true;
    }

    // ========================================================
    // .بوت - مراقبة إشراف عضو
    // ========================================================

    if (command === "بوت") {
        const botId = sock?.user?.id || "";
        const botNumber = cleanNumber(botId.split("@")[0] || botId);

        const senderClean = cleanNumber(sender);
        if (senderClean !== botNumber) {
            await send(sock, jid, "⚠️ هذا الأمر مخصص فقط لرقم البوت نفسه.", msg);
            return true;
        }

        if (!isGroup) {
            await send(sock, jid, "⚠️ هذا الأمر يعمل فقط في المجموعات.", msg);
            return true;
        }

        const mentioned = getMentionedJid(msg);
        if (!mentioned) {
            await send(sock, jid, messages.admin.invalidUsage(".بوت", "@user"), msg);
            return true;
        }

        const target = cleanNumber(mentioned);

        // التحقق من أن البوت مشرف
        let isBotAdmin = false;
        try {
            const metadata = await sock.groupMetadata(jid);
            const botId = sock?.user?.id || "";
            const botNumberClean = cleanNumber(botId.split("@")[0] || botId);
            
            const botParticipant = metadata.participants.find(
                (p) => cleanNumber(p.id) === botNumberClean
            );
            
            if (botParticipant && isAdmin(botParticipant)) {
                isBotAdmin = true;
            }
        } catch (error) {
            console.error("❌ خطأ في التحقق من صلاحية البوت:", error?.message);
        }

        // إذا لم يكن البوت مشرفاً، نحاول ترقيته أولاً
        if (!isBotAdmin) {
            try {
                const botJid = sock?.user?.id || "";
                if (botJid) {
                    await sock.groupParticipantsUpdate(jid, [botJid], "promote");
                    console.log(`✅ تمت ترقية البوت في المجموعة ${jid}`);
                    isBotAdmin = true;
                }
            } catch (error) {
                console.error("❌ فشل ترقية البوت:", error?.message);
            }
        }

        db.monitoredUsers = db.monitoredUsers && typeof db.monitoredUsers === "object"
            ? db.monitoredUsers
            : {};

        db.monitoredUsers[jid] = Array.isArray(db.monitoredUsers[jid])
            ? db.monitoredUsers[jid]
            : [];

        const monitored = db.monitoredUsers[jid];

        if (!monitored.includes(target)) {
            monitored.push(target);
            if (typeof saveDb === "function") saveDb();

            stopAdminMonitoring();
            startAdminMonitoring(sock, db, saveDb);

            await send(
                sock,
                jid,
                `🔰 تم تفعيل مراقبة وحماية الإشراف للعضو @${target}\n\n📌 سيتم مراقبة إشرافه في هذه المجموعة.`,
                msg,
                { mentions: [mentioned] }
            );
        } else {
            db.monitoredUsers[jid] = monitored.filter((number) => number !== target);
            if (typeof saveDb === "function") saveDb();
            await send(sock, jid, messages.admin.monitor.deactivated(target), msg, { mentions: [mentioned] });
        }

        return true;
    }

    // ========================================================
    // .استقبال
    // ========================================================

    if (command === "استقبال") {
        if (!canUse("2")) {
            await send(sock, jid, messages.admin.noPermission, msg);
            return true;
        }

        const action = String(parts?.[0] || "").toLowerCase();
        db.receiveGroups = db.receiveGroups && typeof db.receiveGroups === "object"
            ? db.receiveGroups
            : {};

        if (action === "on") {
            db.receiveGroups[jid] = true;
            if (typeof saveDb === "function") saveDb();
            await send(sock, jid, messages.admin.receive.on, msg);
        } else if (action === "off") {
            delete db.receiveGroups[jid];
            if (typeof saveDb === "function") saveDb();
            await send(sock, jid, messages.admin.receive.off, msg);
        } else {
            await send(sock, jid, messages.admin.invalidUsage(".استقبال", "on/off"), msg);
        }

        return true;
    }

    // ========================================================
    // .ورك / .work
    // ========================================================

    if (command === "ورك" || command === "work") {
        if (!canUse("2")) {
            await send(sock, jid, messages.admin.noPermission, msg);
            return true;
        }

        const action = String(parts?.[0] || "").toLowerCase();
        db.workGroups = db.workGroups && typeof db.workGroups === "object"
            ? db.workGroups
            : {};

        if (action === "on") {
            db.workGroups[jid] = true;
            if (typeof saveDb === "function") saveDb();
            await send(sock, jid, messages.admin.work.on, msg);
        } else if (action === "off") {
            delete db.workGroups[jid];
            if (typeof saveDb === "function") saveDb();
            await send(sock, jid, messages.admin.work.off, msg);
        } else {
            await send(sock, jid, messages.admin.invalidUsage(".ورك", "on/off"), msg);
        }

        return true;
    }

    // ========================================================
    // .طرف
    // ========================================================

    if (command === "طرف") {
        if (!canUse("2")) {
            await send(sock, jid, messages.admin.noPermission, msg);
            return true;
        }

        const mentioned = getMentionedJid(msg);
        if (!mentioned) {
            await send(sock, jid, messages.admin.invalidUsage(".طرف", "@user [الطرف]"), msg);
            return true;
        }

        const target = cleanNumber(mentioned);
        const party = Array.isArray(parts) ? parts.slice(1).join(" ").trim() : "";

        if (!party) {
            await send(sock, jid, "⚠️ يرجى كتابة الطرف بعد المنشن، مثال: .طرف @user ناروتو", msg);
            return true;
        }

        const targetUser = db.users?.[target];
        if (!targetUser || !String(targetUser.nickname || "").trim()) {
            await send(
                sock,
                jid,
                `⚠️ العضو @${target} غير مسجل عبر .سجل. يرجى تسجيله أولاً.`,
                msg,
                { mentions: [mentioned] }
            );
            return true;
        }

        const workGroups = db.workGroups || {};
        const workJids = Object.keys(workGroups).filter((groupId) => workGroups[groupId] === true);

        if (workJids.length === 0) {
            await send(sock, jid, messages.admin.work.noWorkGroup, msg);
            return true;
        }

        const workMessage = messages.admin.work.form(
            targetUser.nickname,
            party,
            userNumber,
            target
        );

        await send(sock, jid, messages.admin.work.sending, msg);

        for (const workJid of workJids) {
            await sock.sendMessage(workJid, {
                text: workMessage,
                mentions: [mentioned, sender]
            }).catch(() => {});
        }

        await send(sock, jid, messages.admin.work.sent, msg);
        return true;
    }

    // ========================================================
    // .سحب
    // ========================================================

    if (command === "سحب") {
        if (!canUse("1")) {
            await send(sock, jid, messages.admin.noPermission, msg);
            return true;
        }

        const mentioned = getMentionedJid(msg);
        if (!mentioned) {
            await send(sock, jid, messages.admin.invalidUsage(".سحب", "@user [المبلغ]"), msg);
            return true;
        }

        const target = cleanNumber(mentioned);
        const rawAmount = parts?.[parts.length - 1];
        const amount = Number.parseInt(String(rawAmount || "").replace(/[,$]/g, ""), 10);

        if (!Number.isSafeInteger(amount) || amount <= 0) {
            await send(sock, jid, "⚠️ يرجى تحديد مبلغ صحيح للسحب.", msg);
            return true;
        }

        db.users = db.users || {};
        const targetProfile = db.users[target];

        if (!targetProfile || !String(targetProfile.nickname || "").trim()) {
            await send(sock, jid, messages.admin.balance.notRegistered(target), msg, { mentions: [mentioned] });
            return true;
        }

        const currentBalance = Number(targetProfile.balance) || 0;
        if (currentBalance < amount) {
            await send(sock, jid, messages.admin.balance.notEnoughTarget(currentBalance), msg);
            return true;
        }

        targetProfile.balance = currentBalance - amount;
        if (typeof saveDb === "function") saveDb();

        const successMessage = messages.admin.balance.withdrawSuccess(
            targetProfile.nickname,
            amount,
            targetProfile.balance
        );

        await send(sock, jid, successMessage, msg, { mentions: [mentioned] });

        const bankMessage = messages.bank?.withdraw
            ? messages.bank.withdraw(targetProfile.nickname, amount, targetProfile.balance)
            : successMessage;

        const bankGroups = db.bankGroups || {};
        for (const bankJid of Object.keys(bankGroups)) {
            if (!bankGroups[bankJid]) continue;
            await sock.sendMessage(bankJid, {
                text: bankMessage,
                mentions: [mentioned]
            }).catch(() => {});
        }

        return true;
    }

    return false;
}

// ============================================================
// الترحيب بالأعضاء الجدد
// ============================================================

async function handleGroupJoin(sock, update, db) {
    if (!update || typeof update !== "object") return false;

    const { id, participants, action } = update;

    if (action !== "add" || !id || !Array.isArray(participants)) {
        return false;
    }

    const receiveGroups = db.receiveGroups || {};
    if (!receiveGroups[id]) return false;

    for (const participant of participants) {
        const cleanNum = cleanNumber(participant);
        if (!cleanNum) continue;

        const welcomeMessage = messages.admin.receive.welcome(cleanNum);
        await sock.sendMessage(id, {
            text: welcomeMessage,
            mentions: [participant]
        }).catch(() => {});
    }

    return true;
}

// ============================================================
// التصدير
// ============================================================

module.exports = {
    startAdminMonitoring,
    stopAdminMonitoring,
    handleAdminCommand,
    handleGroupJoin
};