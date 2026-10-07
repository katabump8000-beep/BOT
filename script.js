// ============================================
// F.I.R — مملكة النار
// VERSION 11 — عرض النموذج مباشرة
// ============================================

(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const screens = {
    form:       $("#screen-form"),
    success:    $("#screen-success"),
    registered: $("#screen-registered"),
    denied:     $("#screen-denied"),
    error:      $("#screen-error")
  };

  const form        = $("#register-form");
  const inputNick   = $("#nickname");
  const inputRef    = $("#referrer");
  const inputAge    = $("#age");
  const inputGenderCustom = $("#gender-custom");
  const checkboxAgree = $("#agree");
  const btnSubmit   = $("#btn-submit");
  const btnText     = $("#btn-text");
  const btnSpinner  = $("#btn-spinner");
  const btnEnter    = $("#btn-enter");
  const clickSound  = $("#click-sound");

  const genderButtons = $$("#gender-seg button");

  const state = {
    token: "",
    apiUrl: "",
    gender: "",
    submitting: false
  };

  // ==========================================
  // 🎵 صوت الضغطة
  // ==========================================
  let soundUnlocked = false;

  function unlockSound() {
    if (soundUnlocked) return;
    if (!CONFIG.SOUND_ENABLED || !clickSound) return;
    try {
      clickSound.volume = 0;
      const p = clickSound.play();
      if (p && typeof p.then === "function") {
        p.then(() => {
          clickSound.pause();
          clickSound.currentTime = 0;
          clickSound.volume = 1;
          soundUnlocked = true;
        }).catch(() => {});
      }
    } catch (_) {}
  }

  function playClick() {
    if (!CONFIG.SOUND_ENABLED || !clickSound) return;
    if (!soundUnlocked) unlockSound();
    try {
      clickSound.currentTime = 0;
      const p = clickSound.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch (_) {}
  }

  function vibrate() {
    if (!CONFIG.VIBRATION_ENABLED) return;
    try { if (navigator.vibrate) navigator.vibrate(15); } catch (_) {}
  }

  function onAnyTap() { playClick(); vibrate(); }

  document.addEventListener("touchstart", unlockSound, { once: true, passive: true });
  document.addEventListener("mousedown",   unlockSound, { once: true });
  document.addEventListener("keydown",     unlockSound, { once: true });

  // ==========================================
  // 🖥️ التنقل بين الشاشات
  // ==========================================
  function showScreen(name) {
    Object.values(screens).forEach(s => s && s.classList.remove("active"));
    if (screens[name]) screens[name].classList.add("active");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ==========================================
  // ❌ عرض/إخفاء الأخطاء
  // ==========================================
  function setError(field, message) {
    const el = $(`#err-${field}`);
    if (!el) return;
    if (message) {
      el.textContent = message;
      el.classList.add("show");
    } else {
      el.textContent = "";
      el.classList.remove("show");
    }
  }

  function clearAllErrors() {
    ["nickname", "referrer", "gender", "age", "agree"].forEach(f => setError(f, ""));
  }

  // ==========================================
  // 🎂 الجنس
  // ==========================================
  function getGenderValue() {
    if (state.gender === "custom") return inputGenderCustom.value.trim();
    if (state.gender === "male") return "ذكر";
    if (state.gender === "female") return "أنثى";
    return "";
  }

  genderButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      onAnyTap();
      genderButtons.forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      state.gender = btn.dataset.value;
      if (state.gender === "custom") {
        inputGenderCustom.classList.remove("hidden");
        inputGenderCustom.focus();
      } else {
        inputGenderCustom.classList.add("hidden");
        inputGenderCustom.value = "";
      }
      setError("gender", "");
    });
  });

  // ==========================================
  // 🔍 فحص اللقب
  // ==========================================
  let checkTimeout = null;
  let lastCheckedNick = "";

  inputNick.addEventListener("input", () => {
    setError("nickname", "");
    const value = inputNick.value.trim();
    if (value.length < 2) return;
    if (value === lastCheckedNick) return;
    clearTimeout(checkTimeout);
    checkTimeout = setTimeout(async () => {
      lastCheckedNick = value;
      try {
        const taken = await checkNicknameTaken(value);
        if (taken && inputNick.value.trim() === value) {
          setError("nickname", CONFIG.TEXTS.NICKNAME_TAKEN);
        }
      } catch (_) {}
    }, 700);
  });

  // ==========================================
  // 🌐 API URL (مع إصلاح https://)
  // ==========================================
  function getApiUrl() {
    let url = state.apiUrl || CONFIG.API_URL || "";
    url = String(url).trim().replace(/\/$/, "");
    if (!url) return "";
    // 🆕 إضافة https:// تلقائياً إذا ناقصة
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    return url;
  }

  async function apiCall(endpoint, body) {
    const baseUrl = getApiUrl();
    if (!baseUrl) throw new Error("NO_API_URL");
    const res = await fetch(baseUrl + endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store"
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  }

  async function checkNicknameTaken(nick) {
    const data = await apiCall("/api/flow/check-nickname", {
      token: state.token,
      nickname: nick
    });
    return Boolean(data && data.taken);
  }

  // ==========================================
  // ✅ إرسال النموذج
  // ==========================================
  async function submitForm(e) {
    e.preventDefault();
    if (state.submitting) return;

    onAnyTap();
    clearAllErrors();

    const nickname = inputNick.value.trim();
    const referrer = inputRef.value.trim();
    const gender   = getGenderValue();
    const ageRaw   = inputAge.value.trim();
    const agreed   = checkboxAgree.checked;

    let hasError = false;

    if (nickname.length < 2) {
      setError("nickname", "⚠️ يرجى كتابة لقب من حرفين على الأقل.");
      hasError = true;
    }
    if (referrer.length < 2) {
      setError("referrer", "⚠️ يرجى كتابة من طرف من دخلت.");
      hasError = true;
    }
    if (!state.gender) {
      setError("gender", "⚠️ يرجى اختيار جنسك.");
      hasError = true;
    } else if (state.gender === "custom" && gender.length < 1) {
      setError("gender", "⚠️ يرجى كتابة جنسك المخصص.");
      hasError = true;
    }

    let age = null;
    if (ageRaw) {
      const n = parseInt(ageRaw, 10);
      if (!Number.isFinite(n) || n < 5 || n > 99) {
        setError("age", "⚠️ العمر يجب أن يكون بين 5 و 99.");
        hasError = true;
      } else {
        age = n;
      }
    }

    if (!agreed) {
      setError("agree", "⚠️ يجب الموافقة على الملاحظة قبل المتابعة.");
      hasError = true;
    }

    if (hasError) {
      const firstError = $(".error.show");
      if (firstError) firstError.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    state.submitting = true;
    btnSubmit.disabled = true;
    btnText.textContent = "جارٍ التحقق...";
    btnSpinner.classList.remove("hidden");

    try {
      const data = await apiCall("/api/flow/submit", {
        token: state.token,
        nickname,
        referrer,
        gender,
        age
      });

      if (data && data.ok) {
        const link = data.enterLink || CONFIG.ENTER_LINK || "#";
        btnEnter.href = link;
        showScreen("success");
        return;
      }

      if (data && data.errors) {
        Object.entries(data.errors).forEach(([field, msg]) => setError(field, msg));
      } else if (data && data.error) {
        setError("agree", data.error);
      } else {
        setError("agree", "⚠️ حدث خطأ غير متوقع.");
      }

      const firstError = $(".error.show");
      if (firstError) firstError.scrollIntoView({ behavior: "smooth", block: "center" });

    } catch (err) {
      console.error("[submitForm]", err);
      const msg = String(err && err.message || "");
      if (msg.includes("NO_API_URL")) {
        setError("agree", "⚠️ لم يتم إعداد رابط البوت.");
      } else {
        setError("agree", CONFIG.TEXTS.CONNECTION_ERROR);
      }
    } finally {
      state.submitting = false;
      btnSubmit.disabled = false;
      btnText.textContent = "التالي ←";
      btnSpinner.classList.add("hidden");
    }
  }

  // ==========================================
  // 🔍 فحص الجلسة (في الخلفية — لا يعطّل النموذج)
  // ==========================================
  async function checkSessionInBackground() {
    try {
      const data = await apiCall("/api/flow/check-session", { token: state.token });
      if (!data) return;

      // مسجل مسبقاً → شاشة "مسجل بالفعل"
      if (data.valid !== true && data.reason === "registered") {
        const link = data.enterLink || CONFIG.ENTER_LINK || "";
        const btnReg = document.getElementById("btn-enter-registered");
        if (btnReg && link) btnReg.href = link;
        showScreen("registered");
        return;
      }

      // جلسة ليست لهذا الشخص
      if (data.valid !== true && data.reason === "not_your_session") {
        showScreen("denied");
        return;
      }

      // منتهية
      if (data.valid !== true && data.reason === "expired") {
        showScreen("error");
        const title = $("#error-title");
        const text  = $("#error-text");
        if (title) title.textContent = "انتهت صلاحية الرابط";
        if (text)  text.textContent  = "يرجى طلب رابط جديد من المشرف عبر أمر .جديد";
        return;
      }

      // ✅ الجلسة صحيحة → نُبقي النموذج معروضاً
    } catch (err) {
      // فشل الاتصال — نتجاهل، النموذج يبقى معروضاً
      console.warn("[checkSession] ignored:", err?.message || err);
    }
  }

  // ==========================================
  // 🚀 التهيئة
  // ==========================================
  function init() {
    const params = new URLSearchParams(window.location.search);

    state.token = params.get("token") || "";
    state.apiUrl = params.get("api") || "";

    // ربط الأزرار
    btnEnter.addEventListener("click", onAnyTap);
    form.addEventListener("submit", submitForm);
    $$("button").forEach(b => b.addEventListener("mousedown", onAnyTap));

    // ==========================================
    // 1) إذا لم يوجد Token → شاشة رفض
    // ==========================================
    if (!state.token || state.token.length < 10) {
      showScreen("denied");
      return;
    }

    // ==========================================
    // 2) عرض النموذج مباشرة (لا انتظار)
    // ==========================================
    showScreen("form");
    setTimeout(() => inputNick.focus(), 100);

    // ==========================================
    // 3) فحص الجلسة في الخلفية (اختياري)
    // ==========================================
    if (getApiUrl()) {
      checkSessionInBackground();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

})();
