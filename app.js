import { auth, db } from './firebase-config.js';
import {
    createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
    collection, addDoc, deleteDoc, updateDoc, doc, onSnapshot, serverTimestamp, query, orderBy, runTransaction, getDocs
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// === GLOBAL STATE ===
let currentPortfolio = null;
let exchangeRates = { USD: 50.5, SAR: 13.5, GOLD: 2750 }; // Defaults
let chartInstance = null;

// === AUTH & INIT ===
onAuthStateChanged(auth, (user) => {
    if (user) {
        // Prevent Flash: Only show dashboard if truly ready
        // But data-view handles visibility.
        setView('dashboard');
        loadMarketData();
        loadPortfolios(user.uid);
    } else {
        setView('auth');
    }
});

// === VIEW MANAGER (Robust) ===
function setView(viewName) {
    // 1. GLOBAL STATE (CSS Controls Visibility)
    document.body.dataset.view = viewName;

    // 2. Section Switching
    document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
    const target = document.getElementById(`${viewName}-section`);
    if (target) target.classList.remove('hidden');

    // 3. Nav State
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    if (viewName === 'dashboard') {
        const homeBtn = document.getElementById('nav-home');
        if (homeBtn) homeBtn.classList.add('active');
    }

    // Safety: If Auth, force scrolling to top
    if (viewName === 'auth') window.scrollTo(0, 0);
}

// === AUTH HANDLERS ===
const authForm = document.getElementById('auth-form');
let isRegister = false;

document.getElementById('toggle-auth-mode').addEventListener('click', (e) => {
    isRegister = !isRegister;
    e.target.textContent = isRegister ? "لديك حساب بالفعل؟" : "ليس لديك حساب؟";
    document.getElementById('auth-btn').textContent = isRegister ? "إنشاء حساب" : "تسجيل الدخول";
});

authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const em = document.getElementById('email').value;
    const pw = document.getElementById('password').value;
    const btn = document.getElementById('auth-btn');
    const originalText = btn.textContent;
    btn.textContent = '...';

    try {
        if (isRegister) await createUserWithEmailAndPassword(auth, em, pw);
        else await signInWithEmailAndPassword(auth, em, pw);
        // View change happens in onAuthStateChanged
    } catch (err) {
        showToast("خطأ: " + err.message, true);
        btn.textContent = originalText;
    }
});

document.getElementById('nav-logout').addEventListener('click', () => {
    signOut(auth);
    // View change happens in onAuthStateChanged
});

// === DASHBOARD ===
function loadPortfolios(uid) {
    const grid = document.getElementById('portfolios-grid');
    const q = query(collection(db, "users", uid, "portfolios"), orderBy("createdAt", "desc"));

    onSnapshot(q, (snap) => {
        grid.innerHTML = '';
        let totalWealth = 0;

        if (snap.empty) {
            grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:#666;margin-top:20px">ابدأ بإضافة محفظة</div>`;
        }

        snap.forEach(d => {
            const p = { id: d.id, ...d.data() };
            // Calc Total Wealth in EGP
            let val = parseFloat(p.currentValue) || 0;
            if (p.currency === 'USD') val *= exchangeRates.USD;
            if (p.currency === 'GOLD') val *= exchangeRates.GOLD;

            totalWealth += val;
            grid.appendChild(createPortfolioCard(p));
        });

        document.getElementById('total-wealth').textContent = formatMoney(totalWealth);
    });
}

function createPortfolioCard(p) {
    const div = document.createElement('div');
    div.className = 'p-card';
    div.innerHTML = `
        <span class="p-badge">${p.currency}</span>
        <div>
            <div class="p-val">${formatMoney(p.currentValue, p.currency)}</div>
            <div class="p-name">${p.name}</div>
        </div>
    `;
    div.addEventListener('click', () => openDetails(p));
    return div;
}

// === DETAILS ===
function openDetails(p) {
    currentPortfolio = p;
    setView('details');
    document.getElementById('detail-title').textContent = p.name;

    // Header
    document.getElementById('d-current-val').textContent = formatMoney(p.currentValue, p.currency);
    document.getElementById('d-capital').textContent = formatMoney(p.capital, p.currency);

    const pnl = p.currentValue - p.capital;
    const pnlPer = p.capital > 0 ? (pnl / p.capital) * 100 : 0;
    const pnlEl = document.getElementById('d-pnl');
    pnlEl.textContent = `${pnl >= 0 ? '+' : ''}${pnlPer.toFixed(1)}%`;
    pnlEl.style.color = pnl >= 0 ? 'var(--success)' : 'var(--danger)';

    // Benchmark
    const bar = document.getElementById('bm-p-fill');
    const val = document.getElementById('bm-p-val');
    bar.style.width = Math.min(Math.abs(pnlPer) * 2, 100) + '%';
    bar.style.backgroundColor = pnl >= 0 ? 'var(--primary)' : 'var(--danger)';
    val.textContent = pnlPer.toFixed(1) + '%';

    loadAssets(p.id, p.currency);
    loadChart(p.id);
}

function loadAssets(pid, currency) {
    const list = document.getElementById('assets-list');
    onSnapshot(collection(db, "users", auth.currentUser.uid, "portfolios", pid, "assets"), (snap) => {
        list.innerHTML = '';
        snap.forEach(d => {
            const a = d.data();
            const val = a.qty * a.avgPrice; // Approx
            const div = document.createElement('div');
            div.className = 'asset-item';
            div.innerHTML = `
                <div style="display:flex;align-items:center">
                    <div style="font-weight:700">${a.symbol}</div>
                    <div class="ai-icon"><i class="fa-solid fa-layer-group"></i></div>
                </div>
                <div class="ai-val">
                    <div>${formatMoney(val, currency)}</div>
                    <div style="font-size:0.75rem;color:#666">${a.qty} units</div>
                </div>
            `;
            list.appendChild(div);
        });
    });
}

function loadChart(pid) {
    const ctx = document.getElementById('growthChart');
    if (chartInstance) {
        chartInstance.destroy();
        chartInstance = null;
    }

    // Chart Options (Better Visuals)
    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: ['البداية', 'الآن'],
            datasets: [{
                label: 'القيمة',
                data: [currentPortfolio.capital, currentPortfolio.currentValue],
                borderColor: '#3b82f6',
                backgroundColor: (context) => {
                    const ctx = context.chart.ctx;
                    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
                    gradient.addColorStop(0, 'rgba(59,130,246,0.2)');
                    gradient.addColorStop(1, 'rgba(59,130,246,0)');
                    return gradient;
                },
                fill: true,
                tension: 0.4,
                pointRadius: 4,
                pointBackgroundColor: '#3b82f6'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(15,15,20,0.9)',
                    padding: 12,
                    titleFont: { family: 'Cairo' },
                    bodyFont: { family: 'Inter' },
                    callbacks: {
                        label: (c) => formatMoney(c.raw, currentPortfolio.currency)
                    }
                }
            },
            scales: {
                x: { display: false },
                y: {
                    display: true,
                    position: 'right',
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#666', font: { size: 10, family: 'Inter' } }
                }
            }
        }
    });

    // Try to load history if available to make chart real
    // (Async update)
    getDocs(query(collection(db, "users", auth.currentUser.uid, "portfolios", pid, "history"), orderBy("date", "asc")))
        .then(snap => {
            if (!snap.empty && chartInstance) {
                const labels = [];
                const data = [];
                // Add Start
                if (currentPortfolio.createdAt) {
                    labels.push(new Date(currentPortfolio.createdAt.seconds * 1000).toLocaleDateString());
                    data.push(currentPortfolio.capital);
                }

                snap.forEach(d => {
                    const h = d.data();
                    // Create point for Value Updates
                    if (h.type === 'UPDATE' || h.value) {
                        labels.push(new Date(h.date.seconds * 1000).toLocaleDateString());
                        data.push(h.value);
                    }
                });

                // Push Current
                labels.push('Now');
                data.push(currentPortfolio.currentValue);

                // Update Chart
                chartInstance.data.labels = labels;
                chartInstance.data.datasets[0].data = data;
                chartInstance.update();
            }
        });
}

// === INTERACTIVITY HANDLERS (The Fix) ===

// 1. Navbar Settings
document.getElementById('nav-settings').addEventListener('click', () => {
    showModal(`
        <h3>الإعدادات</h3>
        <p style="color:#666;margin-bottom:15px">إدارة البيانات والنسخ الاحتياطي</p>
        <button class="btn-primary" onclick="showToast('قريباً: تحميل نسخة احتياطية')">تحميل نسخة (JSON)</button>
    `);
});

// 2. Global Ticker
document.getElementById('market-ticker').addEventListener('click', () => {
    showModal(`
        <h3>أسعار السوق (مباشر)</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px">
            <div class="p-card"><span class="p-badge">GOLD</span><div class="p-val">$${exchangeRates.GOLD || '...'}</div></div>
            <div class="p-card"><span class="p-badge">USD</span><div class="p-val">${exchangeRates.USD || '...'}</div></div>
        </div>
    `);
});

// 3. Details Page: Settings
document.getElementById('detail-settings').addEventListener('click', () => {
    showModal(`
        <h3>إعدادات: ${currentPortfolio.name}</h3>
        <button class="btn-primary" style="background:var(--danger); margin-top:10px" onclick="window.deletePortfolio()">حذف المحفظة</button>
     `);
});

// 4. Details Page: Record
document.getElementById('act-record').addEventListener('click', () => {
    showModal(`
        <h3>تحديث القيمة</h3>
        <input id="new-val-input" type="number" placeholder="القيمة الجديدة" value="${currentPortfolio.currentValue}" style="margin-bottom:15px">
        <button class="btn-primary" onclick="window.updateValue()">حفظ التعديل</button>
    `);
});

// 5. Details Page: History
document.getElementById('act-history').addEventListener('click', () => {
    showModal(`
        <h3>سجل العمليات</h3>
        <div id="history-log-list" style="max-height:300px;overflow-y:auto;margin-top:10px">جاري التحميل...</div>
    `);
    loadHistoryLogUI();
});

// 6. Filters
document.querySelectorAll('.f-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.f-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        // Logic for filtering chart time range would go here
    });
});

// === ACTION LOGIC ===
window.updateValue = async () => {
    const el = document.getElementById('new-val-input');
    if (!el) return;
    const val = parseFloat(el.value);
    if (isNaN(val)) return;

    const ref = doc(db, "users", auth.currentUser.uid, "portfolios", currentPortfolio.id);
    await updateDoc(ref, { currentValue: val });
    await addDoc(collection(ref, "history"), { type: 'UPDATE', value: val, date: serverTimestamp() });

    closeModal();
    showToast('تم تحديث القيمة');
};

window.deletePortfolio = async () => {
    if (!confirm('هل أنت متأكد؟ لا يمكن التراجع.')) return;
    await deleteDoc(doc(db, "users", auth.currentUser.uid, "portfolios", currentPortfolio.id));
    closeModal();
    setView('dashboard');
    showToast('تم حذف المحفظة');
};

async function loadHistoryLogUI() {
    const list = document.getElementById('history-log-list');
    if (!list) return;

    const q = query(collection(db, "users", auth.currentUser.uid, "portfolios", currentPortfolio.id, "history"), orderBy("date", "desc"));
    const snap = await getDocs(q);

    list.innerHTML = '';
    if (snap.empty) {
        list.innerHTML = '<p style="color:#666;text-align:center">لا يوجد سجل</p>';
        return;
    }

    snap.forEach(d => {
        const h = d.data();
        const dateStr = h.date ? new Date(h.date.seconds * 1000).toLocaleDateString('ar-EG') : '-';
        const typeStr = h.type === 'DEPOSIT' ? 'إيداع/شراء' : 'تحديث قيمة';
        const amountStr = formatMoney(h.amount || h.value, currentPortfolio.currency);

        const row = document.createElement('div');
        row.style.cssText = "display:flex;justify-content:space-between;padding:10px;border-bottom:1px solid #333";
        row.innerHTML = `
            <div>
                <div style="font-weight:bold;font-size:0.9rem">${typeStr}</div>
                <div style="font-size:0.75rem;color:#666">${dateStr}</div>
            </div>
            <div style="font-family:'Inter';font-weight:bold">${amountStr}</div>
        `;
        list.appendChild(row);
    });
}

// === MODALS & UTILS ===
document.getElementById('add-portfolio-btn').addEventListener('click', () => {
    showModal(`
        <h3>محفظة جديدة</h3>
        <input id="new-p-name" placeholder="الاسم" style="margin-bottom:10px">
        <input id="new-p-cap" type="number" placeholder="رأس المال" style="margin-bottom:10px">
        <select id="new-p-cur" style="margin-bottom:15px">
            <option value="EGP">EGP</option><option value="USD">USD</option><option value="GOLD">GOLD</option>
        </select>
        <button class="btn-primary" onclick="window.createPortfolio()">إنشاء</button>
    `);
});

window.createPortfolio = async () => {
    const name = document.getElementById('new-p-name').value;
    const cap = parseFloat(document.getElementById('new-p-cap').value);
    const cur = document.getElementById('new-p-cur').value;
    if (!name || !cap) return showToast('بيانات ناقصة', true);

    await addDoc(collection(db, "users", auth.currentUser.uid, "portfolios"), {
        name, capital: cap, currentValue: cap, currency: cur, createdAt: serverTimestamp()
    });
    closeModal();
};

document.getElementById('act-add').addEventListener('click', () => {
    showModal(`
        <h3>إضافة أصل</h3>
        <input id="asset-sym" placeholder="الرمز (مثال: AAPL)" style="margin-bottom:10px">
        <input id="asset-qty" type="number" placeholder="الكمية" style="margin-bottom:10px">
        <input id="asset-price" type="number" placeholder="سعر الشراء" style="margin-bottom:15px">
        <button class="btn-primary" onclick="window.addAsset()">إضافة</button>
    `);
});

window.addAsset = async () => {
    const sym = document.getElementById('asset-sym').value;
    const qty = parseFloat(document.getElementById('asset-qty').value);
    const price = parseFloat(document.getElementById('asset-price').value);

    await runTransaction(db, async (t) => {
        const pRef = doc(db, "users", auth.currentUser.uid, "portfolios", currentPortfolio.id);
        const pDoc = await t.get(pRef);
        const cost = qty * price;
        const newCap = pDoc.data().capital + cost;
        const newVal = pDoc.data().currentValue + cost; // Approx

        const aRef = doc(collection(pRef, "assets"));
        t.set(aRef, { symbol: sym, qty, avgPrice: price, date: serverTimestamp() });
        t.update(pRef, { capital: newCap, currentValue: newVal });

        // Add History Log Logic Here if needed
        const hRef = doc(collection(pRef, "history"));
        t.set(hRef, { type: 'DEPOSIT', amount: cost, date: serverTimestamp() });
    });
    closeModal();
};

window.toggleModal = closeModal;
function showModal(html) {
    const box = document.getElementById('modal-box');
    box.innerHTML = html + '<button class="btn-icon" onclick="window.toggleModal()" style="position:absolute;top:20px;left:20px"><i class="fa-solid fa-xmark"></i></button>';
    document.getElementById('modal-overlay').classList.remove('hidden');
}
function closeModal() { document.getElementById('modal-overlay').classList.add('hidden'); }

document.getElementById('back-home').addEventListener('click', () => setView('dashboard'));
document.getElementById('nav-home').addEventListener('click', () => setView('dashboard'));

function showToast(msg, err = false) {
    const t = document.getElementById('toast');
    if (t) {
        t.textContent = msg;
        t.style.borderColor = err ? 'red' : 'green';
        t.classList.remove('hidden');
        setTimeout(() => t.classList.add('hidden'), 3000);
    }
}

function formatMoney(amount, currency = 'EGP') {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency === 'GOLD' ? 'USD' : currency, minimumFractionDigits: 0 }).format(amount);
}

async function loadMarketData() {
    try {
        const res = await fetch('https://open.er-api.com/v6/latest/USD');
        const data = await res.json();
        if (data.rates) exchangeRates.USD = data.rates.EGP.toFixed(2);
    } catch (e) { }

    const els = {
        gold: document.getElementById('t-gold'),
        usd: document.getElementById('t-usd'),
        al: document.getElementById('t-al')
    };
    if (els.gold) els.gold.textContent = `$${exchangeRates.GOLD}`;
    if (els.usd) els.usd.textContent = exchangeRates.USD;
    if (els.al) els.al.textContent = '$2620';
}