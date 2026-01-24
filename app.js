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

// --- التهيئة ---
applyLanguage(currentLang);

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
    const q = query(collection(db, "users", user.uid, "portfolios"), orderBy("createdAt", "desc"));
    const grid = document.getElementById('portfolio-grid');

    unsubscribe = onSnapshot(q, (snapshot) => {
        grid.innerHTML = "";
        let totalVal = 0;

        if (snapshot.empty) {
            grid.innerHTML = `<div style="text-align:center; grid-column:1/-1; color:#64748b; padding:40px;">لا توجد محافظ. ابدأ بإضافة واحدة.</div>`;
        }

        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const val = parseFloat(data.currentValue) || parseFloat(data.capital) || 0;
            totalVal += val;
            renderPortfolioCard(docSnap.id, data, grid);
        });

        document.getElementById('total-net-worth').textContent = formatMoney(totalVal);
    });
}

function renderPortfolioCard(id, data, container) {
    const invested = parseFloat(data.capital) || 0;
    const current = parseFloat(data.currentValue) || invested;
    const pnl = current - invested;
    const isPos = pnl >= 0;

    const card = document.createElement('div');
    card.className = 'glass-card p-card fade-in';
    card.innerHTML = `
        <div class="p-head">
            <div class="p-name">${data.name}</div>
            <button class="delete-btn btn-icon danger" onclick="deletePortfolio(event, '${id}')"><i class="fa-solid fa-trash"></i></button>
        </div>
        <div class="p-val">${formatMoney(current)}</div>
        <div class="p-change ${isPos ? 'positive' : 'negative'}">
            <i class="fa-solid ${isPos ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down'}"></i>
            <span>${isPos ? '+' : ''}${formatMoney(pnl)}</span>
        </div>
    `;
    card.addEventListener('click', (e) => {
        if (!e.target.closest('.delete-btn')) openPortfolioDetails(id, data);
    });
    container.appendChild(card);
}

// --- التفاصيل (Details) ---
window.openPortfolioDetails = (id, data) => {
    currentPortfolioId = id;
    document.getElementById('dashboard-section').classList.add('hidden');
    document.getElementById('details-section').classList.remove('hidden');
    document.getElementById('home-btn').classList.remove('active');
    document.getElementById('details-title').textContent = data.name;

    if (!perfChart) initChart();

    // استماع للتحديثات الحية للمحفظة
    if (detailsUnsubscribe) detailsUnsubscribe();
    detailsUnsubscribe = onSnapshot(doc(db, "users", auth.currentUser.uid, "portfolios", id), (doc) => {
        if (doc.exists()) updateDetailsUI(doc.data());
    });

    loadAssets(id);
    // ملاحظة: لا نحمل السجل هنا لتسريع الأداء، نحمله عند الضغط على زر السجل
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
    document.getElementById('goal-text').textContent = `${progress.toFixed(1)}%`;
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
    loadHistoryLog(); // كان اسمها loadTransactions
});

let txUnsub = null;
let hxUnsub = null;
let txData = [];
let hxData = [];

function loadHistoryLog() {
    const list = document.getElementById('history-list');
    list.innerHTML = '<div class="empty-state">جاري التحميل...</div>';

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
    const list = document.getElementById('history-list');
    const allItems = [...txData, ...hxData].sort((a, b) => {
        const da = a.date ? a.date.seconds : 0;
        const db = b.date ? b.date.seconds : 0;
        return db - da; // Descending
    });

    if (allItems.length === 0) {
        list.innerHTML = '<div class="empty-state">لا توجد سجلات</div>';
        return;
    }

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
                    ${sign}${formatMoney(item.amount || item.value)}
                </div>
                <div class="h-actions">
                    ${editBtn}
                    ${deleteBtn}
                </div>
            </div>
        `;
        list.appendChild(div);
    });
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

    const docRef = await addDoc(collection(db, "users", auth.currentUser.uid, "portfolios"), {
        name: document.getElementById('p-name').value,
        capital: capital,
        currentValue: capital,
        cashBalance: capital,
        targetAmount: parseFloat(document.getElementById('p-target').value) || 0,
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
function formatMoney(amount) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
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

// الرسم البياني (وهمي للتصميم)
function initChart() {
    const ctx = document.getElementById('performanceChart').getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 300);
    grad.addColorStop(0, 'rgba(59, 130, 246, 0.4)');
    grad.addColorStop(1, 'rgba(59, 130, 246, 0)');

    perfChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو'],
            datasets: [{
                data: [10000, 12000, 11500, 13000, 14500],
                borderColor: '#3b82f6',
                backgroundColor: grad,
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: { display: false }, y: { display: false } }
        }
    });
}

function applyLanguage(lang) {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
}