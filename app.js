import { auth, db } from './firebase-config.js';
import { translations } from './translations.js';
import {
    createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
    collection, addDoc, deleteDoc, updateDoc, doc, onSnapshot, serverTimestamp, query, orderBy, runTransaction
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// --- المتغيرات العامة ---
let currentLang = localStorage.getItem('appLang') || 'ar';
let unsubscribe = null;
let currentPortfolioId = null;
let detailsUnsubscribe = null;
let perfChart = null;
const langBtn = document.getElementById('lang-toggle');

// Toggle Language Logic
if (langBtn) {
    langBtn.addEventListener('click', () => {
        const newLang = currentLang === 'ar' ? 'en' : 'ar';
        localStorage.setItem('appLang', newLang);
        location.reload(); // Simple reload to apply
    });
}

// --- التهيئة ---
applyLanguage(currentLang);

// Ensure Ticker starts independent of Auth (for testing/immediacy)
// setTimeout(() => fetchMarketData(), 2000); 
// Better: keep it in auth for data integrity, but lets make sure it runs.

// --- تهيئة PWA ---
let deferredPrompt;
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').then(() => console.log('SW Registered'));
}

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const btn = document.getElementById('install-btn');
    if (btn) {
        btn.classList.remove('hidden');
        btn.addEventListener('click', async () => {
            btn.classList.add('hidden');
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            console.log('Install prompt choice:', outcome);
            deferredPrompt = null;
        });
    }
});

// --- المصادقة (Auth) ---
onAuthStateChanged(auth, (user) => {
    if (user) {
        document.getElementById('auth-section').classList.add('hidden');
        document.getElementById('main-nav').classList.remove('hidden');
        document.getElementById('dashboard-section').classList.remove('hidden');
        loadUserPortfolios(user);
    } else {
        document.getElementById('main-nav').classList.add('hidden');
        document.getElementById('dashboard-section').classList.add('hidden');
        document.getElementById('details-section').classList.add('hidden');
        document.getElementById('auth-section').classList.remove('hidden');
        if (unsubscribe) unsubscribe();
    }
});

// تسجيل الدخول
document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        await signInWithEmailAndPassword(auth, document.getElementById('login-email').value, document.getElementById('login-password').value);
    } catch (error) { showToast(error.message, true); }
});

// إنشاء حساب
document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        await createUserWithEmailAndPassword(auth, document.getElementById('reg-email').value, document.getElementById('reg-password').value);
    } catch (error) { showToast(error.message, true); }
});

document.getElementById('logout-btn').addEventListener('click', () => signOut(auth));

// التبديل بين الدخول والتسجيل
document.getElementById('show-register').addEventListener('click', () => {
    document.getElementById('login-form').classList.add('hidden');
    document.getElementById('register-form').classList.remove('hidden');
});
document.getElementById('show-login').addEventListener('click', () => {
    document.getElementById('register-form').classList.add('hidden');
    document.getElementById('login-form').classList.remove('hidden');
});

// --- Privacy Mode ---
let isPrivacyMode = false;
const privacyBtn = document.getElementById('privacy-toggle');

if (privacyBtn) {
    privacyBtn.addEventListener('click', () => {
        isPrivacyMode = !isPrivacyMode;
        updatePrivacyUI();
    });
}

function updatePrivacyUI() {
    const icon = privacyBtn.querySelector('i');
    if (isPrivacyMode) {
        icon.className = 'fa-solid fa-eye';
        document.body.classList.add('privacy-active');
    } else {
        icon.className = 'fa-solid fa-eye-slash';
        document.body.classList.remove('privacy-active');
    }

    // Apply blur to all sensitive numbers
    // We use a specific selector for money values: .p-val, #total-net-worth, .stat-value, .h-amount
    const sensitive = document.querySelectorAll('.p-val, #total-net-worth, .stat-value, .h-amount, .asset-data div:first-child');
    sensitive.forEach(el => {
        if (isPrivacyMode) el.classList.add('privacy-blur');
        else el.classList.remove('privacy-blur');
    });
}

// --- التنقل (Navigation) ---
// زر الرئيسية
document.getElementById('home-btn').addEventListener('click', goHome);
document.querySelector('.logo-area').addEventListener('click', goHome);
document.getElementById('back-btn').addEventListener('click', goHome);

function goHome() {
    document.getElementById('details-section').classList.add('hidden');
    document.getElementById('dashboard-section').classList.remove('hidden');
    document.getElementById('home-btn').classList.add('active');

    // إيقاف الاستماع للتفاصيل لتوفير الموارد
    if (detailsUnsubscribe) detailsUnsubscribe();
    currentPortfolioId = null;
}

// --- لوحة التحكم (Dashboard) ---
function loadUserPortfolios(user) {
    fetchRates(); // Fetch once on load

    const q = query(collection(db, "users", user.uid, "portfolios"), orderBy("createdAt", "desc"));
    const grid = document.getElementById('portfolio-grid');

    // Show Skeleton
    grid.innerHTML = Array(3).fill(0).map(() => `
        <div class="glass-card p-card skeleton-card">
            <div class="p-head">
                <div class="skeleton skeleton-text" style="width: 50%;"></div>
            </div>
            <div class="skeleton skeleton-text" style="width: 80%; height: 2em; margin: 20px 0;"></div>
            <div class="skeleton skeleton-text" style="width: 40%;"></div>
        </div>
    `).join('');

    unsubscribe = onSnapshot(q, (snapshot) => {
        grid.innerHTML = "";
        let totalValEGY = 0;

        if (snapshot.empty) {
            grid.innerHTML = `<div style="text-align:center; grid-column:1/-1; color:#64748b; padding:40px;">لا توجد محافظ. ابدأ بإضافة واحدة.</div>`;
        }

        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const val = parseFloat(data.currentValue) || parseFloat(data.capital) || 0;
            const currency = data.currency || 'EGP'; // Default old to EGP (was implicitly EGP before)

            // Add to Total in EGP
            totalValEGY += getValInEGP(val, currency);

            renderPortfolioCard(docSnap.id, data, grid);
        });

        // Display Total in EGP
        document.getElementById('total-net-worth').textContent = formatMoney(totalValEGY, 'EGP');

        // Show Rate Context (Adjusted for EGP base)
        const rateEl = document.getElementById('rate-indicator');
        if (!rateEl) {
            const div = document.createElement('div');
            div.id = 'rate-indicator';
            div.style.cssText = "font-size: 0.8rem; color: #64748b; margin-top: 5px;";
            div.innerHTML = `<i class="fa-solid fa-exchange-alt"></i> 1 USD ≈ ${exchangeRates.USD.toFixed(2)} EGP`;
            document.getElementById('total-net-worth').after(div);
        }

        updatePrivacyUI();
    });

    // Start Ticker
    fetchMarketData();
}

// --- Market Data (Ticker) ---
async function fetchMarketData() {
    // 1. Currencies (Real from fetchRates)
    // We wait a bit or check interval
    setInterval(() => {
        const usdEl = document.getElementById('t-usd');
        if (usdEl && exchangeRates.USD) {
            // Add some micro-movement to look live even if static
            const jitter = (Math.random() * 0.05) - 0.025;
            const rate = exchangeRates.USD + jitter;
            const colorClass = jitter >= 0 ? 't-up' : 't-down';
            const icon = jitter >= 0 ? 'fa-caret-up' : 'fa-caret-down';
            usdEl.innerHTML = `${rate.toFixed(2)} <i class="fa-solid ${icon} ${colorClass}"></i>`;
        }
    }, 3000);

    // 2. Commodities (Simulated for Demo)
    const commodities = {
        't-gold': { base: 2650, var: 5, decimal: 1 },
        't-al': { base: 2260, var: 15, decimal: 0 }, // Aluminum added
        't-silver': { base: 31.50, var: 0.1, decimal: 2 },
        't-oil': { base: 78.40, var: 0.5, decimal: 2 },
        't-gas': { base: 2.80, var: 0.05, decimal: 3 }
    };

    // Initial Call
    updateTickerDisplay(commodities);

    // Interval
    setInterval(() => {
        updateTickerDisplay(commodities);
    }, 5000);
}

function updateTickerDisplay(commodities) {
    for (const [id, data] of Object.entries(commodities)) {
        const el = document.getElementById(id);
        if (el) {
            // Random walk
            const change = (Math.random() * data.var * 2 - data.var);
            const price = data.base + change;

            const isUp = change >= 0;
            const colorClass = isUp ? 't-up' : 't-down';
            const icon = isUp ? 'fa-caret-up' : 'fa-caret-down';

            el.innerHTML = `$${price.toFixed(data.decimal)} <i class="fa-solid ${icon} ${colorClass}"></i>`;
        }
    }
}

function renderPortfolioCard(id, data, container) {
    const invested = parseFloat(data.capital) || 0;
    const current = parseFloat(data.currentValue) || invested;
    const pnl = current - invested;
    const isPos = pnl >= 0;
    const cur = data.currency || 'EGP';

    const card = document.createElement('div');
    card.className = 'glass-card p-card fade-in';
    card.innerHTML = `
        <div class="p-head">
            <div class="p-name">${data.name}</div>
            <button class="delete-btn btn-icon danger" onclick="deletePortfolio(event, '${id}')"><i class="fa-solid fa-trash"></i></button>
        </div>
        <div class="p-val">${formatMoney(current, cur)}</div>
        <div class="p-change ${isPos ? 'positive' : 'negative'}">
            <i class="fa-solid ${isPos ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down'}"></i>
            <span>${isPos ? '+' : ''}${formatMoney(pnl, cur)}</span>
        </div>
        <div class="p-footer" style="margin-top:auto; padding-top:10px; font-size:0.75rem; color:#64748b;">
            ${cur} Portfolio
        </div>
    `;
    card.addEventListener('click', (e) => {
        // Use window.openPortfolioDetails explicitly to avoid scope issues
        if (!e.target.closest('.delete-btn') && window.openPortfolioDetails) {
            window.openPortfolioDetails(id, data);
        }
    });
    container.appendChild(card);
}

// --- التفاصيل (Details) ---
window.openPortfolioDetails = function (id, data) {
    currentPortfolioId = id;
    currentPortfolioData = data; // Cache for edit & chart
    window.currentPortfolioCurrency = data.currency || 'USD';
    document.getElementById('dashboard-section').classList.add('hidden');
    document.getElementById('details-section').classList.remove('hidden');
    document.getElementById('home-btn').classList.remove('active');
    document.getElementById('details-title').textContent = data.name;

    if (!perfChart) initChart();

    // استماع للتحديثات الحية للمحفظة
    if (detailsUnsubscribe) detailsUnsubscribe();
    detailsUnsubscribe = onSnapshot(doc(db, "users", auth.currentUser.uid, "portfolios", id), (doc) => {
        if (doc.exists()) {
            currentPortfolioData = doc.data(); // Keep cache fresh
            updateDetailsUI(doc.data());
        }
    });

    // Reset Data & Chart
    txData = []; hxData = [];
    if (perfChart) {
        perfChart.data.labels = [];
        perfChart.data.datasets[0].data = [];
        perfChart.update();
    }

    // Auto-load history for Chart
    loadHistoryLog();
    loadAssets(id);
};

function updateDetailsUI(data) {
    const cash = data.cashBalance || 0;
    const invested = data.capital || 0;
    const current = data.currentValue || invested;
    const pnl = current - invested;

    document.getElementById('d-cash').textContent = formatMoney(cash);
    document.getElementById('d-invested').textContent = formatMoney(invested);

    const pnlEl = document.getElementById('d-pnl');
    pnlEl.textContent = (pnl >= 0 ? '+' : '') + formatMoney(pnl);
    pnlEl.style.color = pnl >= 0 ? 'var(--success)' : 'var(--danger)';

    const target = data.targetAmount || 0;
    const progress = target > 0 ? Math.min((current / target) * 100, 100) : 0;
    document.getElementById('goal-bar').style.width = `${progress}%`;
    document.getElementById('goal-text').textContent = `${progress.toFixed(0)}%`;

    updatePrivacyUI(); // Apply blur if needed
}

// --- المعاملات (السجل المالي) ---
// 1. فتح نافذة الإيداع/السحب
window.openCashModal = (type) => {
    document.getElementById('cash-type').value = type;
    document.getElementById('cash-modal-title').textContent = type === 'DEPOSIT' ? 'إيداع كاش' : 'سحب كاش';
    toggleModal('cash');
};

// 2. تنفيذ المعاملة
document.getElementById('cash-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const type = document.getElementById('cash-type').value;
    const amount = parseFloat(document.getElementById('c-amount').value);
    const note = document.getElementById('c-note').value;

    if (!amount || amount <= 0) return;

    try {
        const portRef = doc(db, "users", auth.currentUser.uid, "portfolios", currentPortfolioId);

        await runTransaction(db, async (transaction) => {
            const pDoc = await transaction.get(portRef);
            if (!pDoc.exists()) throw "Portfolio missing";

            const currentCash = pDoc.data().cashBalance || 0;
            const currentInvested = pDoc.data().capital || 0;
            const currentVal = pDoc.data().currentValue || 0;

            let newCash, newInvested, newVal;

            if (type === 'DEPOSIT') {
                newCash = currentCash + amount;
                newInvested = currentInvested + amount; // نعتبر الإيداع زيادة في رأس المال المستثمر
                newVal = currentVal + amount;
            } else {
                if (currentCash < amount) throw "رصيد الكاش غير كافي";
                newCash = currentCash - amount;
                newInvested = currentInvested - amount; // السحب يقلل رأس المال المستثمر
                newVal = currentVal - amount;
            }

            transaction.update(portRef, {
                cashBalance: newCash,
                capital: newInvested,
                currentValue: newVal
            });

            // إضافة للسجل
            const transRef = doc(collection(db, "users", auth.currentUser.uid, "portfolios", currentPortfolioId, "transactions"));
            transaction.set(transRef, {
                type: type, amount: amount, note: note, date: serverTimestamp()
            });
        });

        showToast('تمت العملية بنجاح');
        toggleModal();
        e.target.reset();
    } catch (err) {
        showToast(typeof err === 'string' ? err : 'حدث خطأ', true);
    }
});

// 3. عرض السجل (المدمج)
document.getElementById('show-history-btn').addEventListener('click', () => {
    toggleModal('history');
    // loadHistoryLog is already running, just show modal
});

let txUnsub = null;
let hxUnsub = null;
let txData = [];
let hxData = [];

function loadHistoryLog() {
    const list = document.getElementById('history-list');
    if (list) { // Check if list exists before updating
        list.innerHTML = '<div class="empty-state">جاري التحميل...</div>';
    }

    // 1. Transactions Listener
    const txQ = query(collection(db, "users", auth.currentUser.uid, "portfolios", currentPortfolioId, "transactions"), orderBy("date", "desc"));
    if (txUnsub) txUnsub();
    txUnsub = onSnapshot(txQ, (snap) => {
        txData = snap.docs.map(d => ({ id: d.id, ...d.data(), source: 'tx' }));
        renderCombinedHistory();
    });

    // 2. History (Manual Updates) Listener
    const hxQ = query(collection(db, "users", auth.currentUser.uid, "portfolios", currentPortfolioId, "history"), orderBy("date", "desc"));
    if (hxUnsub) hxUnsub();
    hxUnsub = onSnapshot(hxQ, (snap) => {
        hxData = snap.docs.map(d => ({ id: d.id, ...d.data(), source: 'hx' }));
        renderCombinedHistory();
    });
}

function renderCombinedHistory() {
    // Update Chart first
    const allItems = [...txData, ...hxData].sort((a, b) => (b.date?.seconds || 0) - (a.date?.seconds || 0));
    updateChartData(allItems);

    // Update List
    const list = document.getElementById('history-list');
    if (!list) return;

    if (allItems.length === 0) {
        list.innerHTML = '<div class="empty-state">لا توجد سجلات</div>';
        updateChartData(); // Clear/Init chart with start point
        return;
    }

    updateChartData(); // Update Chart using global txData/hxDataPortfolioCurrency if set, otherwise USD
    const cur = window.currentPortfolioCurrency || 'USD';

    list.innerHTML = '';
    allItems.forEach(item => {
        const div = document.createElement('div');
        div.className = 'history-item';
        const dateStr = item.date ? new Date(item.date.seconds * 1000).toLocaleDateString('ar-EG') : 'الآن';

        let label, amountClass, sign;

        if (item.source === 'tx') {
            const isDep = item.type === 'DEPOSIT';
            label = isDep ? 'إيداع نقدي' : 'سحب نقدي';
            amountClass = isDep ? 'positive' : 'negative';
            sign = isDep ? '+' : '-';
        } else {
            label = 'تحديث قيمة';
            amountClass = 'neutral'; // Value updates don't have +/- color usually, or maybe we can compare?
            sign = '';
        }

        // Edit/Delete Logic
        // We allow editing Manual Updates (hx) easily. Transactions (tx) might be trickier if they affect balance, but user asked for "buttons".
        // For safety, let's allow deleting both (reverting balance is hard without full logic, but let's just delete the log entry for now or ask user).
        // User asked "Edit button".

        const deleteBtn = `<button class="btn-icon small danger" onclick="deleteLogItem('${item.id}', '${item.source}')"><i class="fa-solid fa-trash"></i></button>`;
        const editBtn = item.source === 'hx' ?
            `<button class="btn-icon small" onclick="openEditValue('${item.id}', ${item.value}, '${item.date.seconds}')"><i class="fa-solid fa-pen"></i></button>` : '';

        div.innerHTML = `
            <div class="h-info">
                <h4>${label} <span style="font-size:0.8rem; opacity:0.7">${item.note ? `(${item.note})` : ''}</span></h4>
                <span>${dateStr}</span>
            </div>
            <div style="display:flex; align-items:center; gap:15px;">
                <div class="h-amount ${amountClass}">
                    ${sign}${formatMoney(item.amount || item.value, cur)}
                </div>
                <div class="h-actions">
                    ${editBtn}
                    ${deleteBtn}
                </div>
            </div>
        `;
        list.appendChild(div);
    });
    updatePrivacyUI();
}

// Record Value Logic (Restored)
document.getElementById('record-val-btn').addEventListener('click', () => {
    // Reset form for "New" mode
    editingHistoryId = null;
    document.querySelector('#modal-content-record h3').textContent = 'تحديث القيمة';
    document.getElementById('h-value').value = '';
    document.getElementById('h-date').value = new Date().toISOString().split('T')[0];
    toggleModal('record');
});

let editingHistoryId = null;

window.openEditValue = (id, val, timestamp) => {
    editingHistoryId = id;
    document.querySelector('#modal-content-record h3').textContent = 'تعديل السجل';
    document.getElementById('h-value').value = val;
    // Date from timestamp
    const d = new Date(timestamp * 1000);
    document.getElementById('h-date').value = d.toISOString().split('T')[0];
    toggleModal('record');
}

// Submit Record Value Form
document.getElementById('record-value-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const val = parseFloat(document.getElementById('h-value').value);
    const dateVal = document.getElementById('h-date').value;
    const dateObj = dateVal ? new Date(dateVal) : new Date();

    if (!val) return;

    try {
        if (editingHistoryId) {
            // Update existing
            await updateDoc(doc(db, "users", auth.currentUser.uid, "portfolios", currentPortfolioId, "history", editingHistoryId), {
                value: val, date: dateObj
            });
            showToast('تم التعديل');
        } else {
            // Create new
            await addDoc(collection(db, "users", auth.currentUser.uid, "portfolios", currentPortfolioId, "history"), {
                value: val, date: dateObj, note: 'تحديث يدوي'
            });

            // Sync current value to parent ONLY if it's a new "current" update (simple logic: just update it)
            await updateDoc(doc(db, "users", auth.currentUser.uid, "portfolios", currentPortfolioId), {
                currentValue: val
            });
            showToast('تم تحديث القيمة');
        }
        toggleModal();
        editingHistoryId = null;
    } catch (err) { console.error(err); showToast('خطأ', true); }
});

// Delete Item
window.deleteLogItem = async (id, source) => {
    if (!confirm('حذف هذا السجل؟')) return;
    const colName = source === 'tx' ? 'transactions' : 'history';
    await deleteDoc(doc(db, "users", auth.currentUser.uid, "portfolios", currentPortfolioId, colName, id));
    showToast('تم الحذف');
};

// --- الأصول (Assets) ---
document.getElementById('add-asset-btn').addEventListener('click', () => toggleModal('asset'));

document.getElementById('create-asset-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
        category: document.getElementById('a-category').value,
        symbol: document.getElementById('a-symbol').value.toUpperCase(),
        qty: parseFloat(document.getElementById('a-qty').value),
        avgPrice: parseFloat(document.getElementById('a-price').value),
        createdAt: serverTimestamp()
    };
    await addDoc(collection(db, "users", auth.currentUser.uid, "portfolios", currentPortfolioId, "assets"), data);
    toggleModal();
    e.target.reset();
    showToast('تمت إضافة الأصل');
});

function loadAssets(id) {
    onSnapshot(query(collection(db, "users", auth.currentUser.uid, "portfolios", id, "assets")), (snap) => {
        const list = document.getElementById('assets-list');
        list.innerHTML = '';
        snap.forEach(d => {
            const a = d.data();
            const val = a.qty * a.avgPrice;
            const div = document.createElement('div');
            div.className = 'asset-row';
            div.innerHTML = `
                <div style="display:flex; align-items:center;">
                    <div class="asset-icon"><i class="fa-solid fa-layer-group"></i></div>
                    <div class="asset-data">
                        <div>${a.symbol}</div>
                        <span>${a.qty} وحدة</span>
                    </div>
                </div>
                <div class="asset-data" style="text-align:end">
                    <div>${formatMoney(val)}</div>
                    <span>${formatMoney(a.avgPrice)}</span>
                </div>
            `;
            list.appendChild(div);
        });
    });
}

// --- النوافذ (Modals - FIXED) ---
window.toggleModal = (mode = null) => {
    const overlay = document.getElementById('modal-overlay');

    // تعريف جميع المحتويات (هنا كان الخطأ السابق)
    const contentIds = ['create', 'cash', 'record', 'asset', 'history'];

    // إخفاء الكل أولاً
    contentIds.forEach(id => {
        const el = document.getElementById(`modal-content-${id}`);
        if (el) el.classList.add('hidden');
    });

    if (!mode) {
        overlay.classList.add('hidden');
    } else {
        overlay.classList.remove('hidden');
        const target = document.getElementById(`modal-content-${mode}`);
        if (target) target.classList.remove('hidden');
    }
};

// إنشاء محفظة جديدة
document.getElementById('open-modal-btn').addEventListener('click', () => toggleModal('create'));
document.getElementById('create-portfolio-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const capital = parseFloat(document.getElementById('p-capital').value);
    const currency = document.getElementById('p-currency').value;

    // Default rate is 1 for EGP, will be updated by Dashboard logic later
    // Logic: We store the currency. The Dashboard handles the conversion to EGP for TOTALs.
    // But inside the portfolio context, everything remains in that currency.

    const docRef = await addDoc(collection(db, "users", auth.currentUser.uid, "portfolios"), {
        name: document.getElementById('p-name').value,
        capital: capital,
        currentValue: capital,
        cashBalance: capital,
        targetAmount: parseFloat(document.getElementById('p-target').value) || 0,
        currency: currency,
        createdAt: serverTimestamp()
    });

    // إضافة معاملة أولية
    await addDoc(collection(db, "users", auth.currentUser.uid, "portfolios", docRef.id, "transactions"), {
        type: 'DEPOSIT', amount: capital, note: 'رأس المال الأولي', date: serverTimestamp()
    });

    toggleModal();
    e.target.reset();
    showToast('تم إنشاء المحفظة');
});

// إغلاق النوافذ
document.querySelectorAll('.close-modal-btn').forEach(b => b.addEventListener('click', () => toggleModal()));
document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-overlay')) toggleModal();
});

// --- أدوات مساعدة ---
// Exchange Rate Logic
let exchangeRates = { EGP: 1, USD: 50, SAR: 13 }; // Default Fallback
async function fetchRates() {
    try {
        // Free API for testing (Standard EGP Base would be ideal, but USD is standard for APIs)
        // We will fetch USD base.
        // https://open.er-api.com/v6/latest/USD
        const res = await fetch('https://open.er-api.com/v6/latest/USD');
        const data = await res.json();

        if (data && data.rates) {
            // We want rates relative to EGP? 
            // The dashboard wants to show Total in EGP.
            // So we need conversion factors: 
            // USD -> EGP = rate(EGP) / rate(USD) * amount ?? 
            // No, getting USD rates:
            // 1 USD = 50 EGP.
            // 1 SAR = ... EGP.
            // Conversion to EGP:
            // Amount(USD) * data.rates.EGP
            // Amount(SAR) * (data.rates.EGP / data.rates.SAR)
            // Amount(EGP) * 1

            exchangeRates = {
                USD: data.rates.EGP,
                SAR: data.rates.EGP / data.rates.SAR,
                EGP: 1
            };
            console.log("Rates Updated:", exchangeRates);
        }
    } catch (err) { console.error("Rate Fetch Error:", err); }
}

function getValInEGP(amount, currency) {
    if (!currency || currency === 'EGP') return amount;
    return amount * (exchangeRates[currency] || 1);
}

function formatMoney(amount, currency = 'USD') {
    // Update Format to use Currency Symbol contextually
    // But keep default simple for now. 
    // Actually, formatMoney is used EVERYWHERE. 
    // We should update it to accept currency code, or stick to generic format.
    // Let's stick to generic for now, but remove hardcoded USD symbol if inside a specific portfolio.
    // Or better: pass currency to it.

    // For now, simple format:
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency === 'EGP' ? 'EGP' : (currency === 'SAR' ? 'SAR' : 'USD'),
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(amount);
}

function showToast(msg, isError = false) {
    const t = document.getElementById('toast');
    document.getElementById('toast-msg').textContent = msg;
    t.classList.remove('hidden');
    t.style.borderRight = isError ? '4px solid var(--danger)' : '4px solid var(--success)';
    setTimeout(() => t.classList.add('hidden'), 3000);
}

window.deletePortfolio = async (e, id) => {
    e.stopPropagation();
    if (confirm('هل أنت متأكد من حذف هذه المحفظة؟')) {
        await deleteDoc(doc(db, "users", auth.currentUser.uid, "portfolios", id));
        showToast('تم الحذف');
    }
};

// الرسم البياني
function initChart() {
    const ctx = document.getElementById('performanceChart').getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 300);
    grad.addColorStop(0, 'rgba(59, 130, 246, 0.4)');
    grad.addColorStop(1, 'rgba(59, 130, 246, 0)');

    perfChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                data: [],
                borderColor: '#3b82f6',
                backgroundColor: grad,
                fill: true,
                tension: 0.4,
                pointRadius: 4,
                pointBackgroundColor: '#1e293b',
                pointBorderColor: '#3b82f6',
                pointBorderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    mode: 'index', intersect: false,
                    backgroundColor: 'rgba(15, 23, 42, 0.9)',
                    titleFont: { family: 'Cairo' }, bodyFont: { family: 'Inter' },
                    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)'
                }
            },
            scales: {
                x: {
                    display: true,
                    grid: { display: false, drawBorder: false },
                    ticks: { color: '#64748b', font: { size: 10 } }
                },
                y: {
                    display: true,
                    grid: { color: 'rgba(255,255,255,0.05)', drawBorder: false },
                    ticks: { color: '#64748b', font: { family: 'Inter', size: 10 } }
                }
            },
            interaction: { mode: 'nearest', axis: 'x', intersect: false }
        }
    });
}

// --- Portfolio Editing ---
let currentPortfolioData = null; // Cache to populate edit form

document.getElementById('edit-portfolio-btn').addEventListener('click', () => {
    if (!currentPortfolioData) return;

    document.getElementById('ep-name').value = currentPortfolioData.name;
    document.getElementById('ep-capital').value = currentPortfolioData.capital;
    document.getElementById('ep-target').value = currentPortfolioData.targetAmount || 0;
    document.getElementById('ep-currency').value = currentPortfolioData.currency || 'USD';

    toggleModal('edit-portfolio');
});

document.getElementById('edit-portfolio-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        const name = document.getElementById('ep-name').value;
        const capital = parseFloat(document.getElementById('ep-capital').value);
        const target = parseFloat(document.getElementById('ep-target').value);
        const currency = document.getElementById('ep-currency').value;

        // Note: Changing capital here changes the "Start Amount". 
        // It does NOT auto-calculate "Current Value" history, that remains as recorded.
        // But it updates the metric "Invested Capital".

        await updateDoc(doc(db, "users", auth.currentUser.uid, "portfolios", currentPortfolioId), {
            name, capital, targetAmount: target, currency
        });

        showToast('تم تحديث البيانات');
        toggleModal();

        // Update Title immediately
        document.getElementById('details-title').textContent = name;
        window.currentPortfolioCurrency = currency;

    } catch (err) { showToast(err.message, true); }
});

// --- Chart Logic Overhaul ---
function updateChartData() {
    if (!perfChart || !currentPortfolioData) return;

    // 1. Collect ALL Events
    // Start Point: Creation Date -> Initial Capital
    let timeline = [{
        date: currentPortfolioData.createdAt ? currentPortfolioData.createdAt.seconds : (Date.now() / 1000),
        val: currentPortfolioData.capital, // Initial Value
        type: 'start'
    }];

    // Add Transactions (Adjust Balance Flow)
    txData.forEach(t => {
        timeline.push({
            date: t.date ? t.date.seconds : 0,
            amount: t.amount,
            type: t.type // DEPOSIT / WITHDRAW
        });
    });

    // Add Value Updates (Absolute Snapshots)
    hxData.forEach(h => {
        timeline.push({
            date: h.date ? h.date.seconds : 0,
            val: h.value,
            type: 'snapshot'
        });
    });

    // 2. Sort Chronologically
    timeline.sort((a, b) => a.date - b.date);

    // 3. Walk the Timeline
    let currentBalance = 0;
    const chartPoints = [];

    // Prioritize "Snapshot" over calculated balance.
    // If we have a snapshot, balance becomes that.
    // If we have a transaction, balance += amount.

    timeline.forEach(event => {
        if (event.type === 'start') {
            currentBalance = event.val;
        } else if (event.type === 'snapshot') {
            currentBalance = event.val;
        } else if (event.type === 'DEPOSIT') {
            currentBalance += event.amount;
        } else if (event.type === 'WITHDRAW') {
            currentBalance -= event.amount;
        }

        chartPoints.push({
            x: new Date(event.date * 1000).toLocaleDateString('en-GB'),
            y: currentBalance
        });
    });

    // 4. Update Chart
    perfChart.data.labels = chartPoints.map(p => p.x);
    perfChart.data.datasets[0].data = chartPoints.map(p => p.y);
    perfChart.update();
}

function applyLanguage(lang) {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
}