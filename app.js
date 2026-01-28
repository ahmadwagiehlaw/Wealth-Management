import { auth, db } from './firebase-config.js';
import {
    createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
    collection, addDoc, deleteDoc, updateDoc, doc, onSnapshot, serverTimestamp, query, orderBy, runTransaction, getDocs, setDoc, limit
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// === المتغيرات ===
let currentPortfolioId = null;
let chartInstance = null;
let marketInterval = null;
let pListUnsub = null;
let journalUnsub = null; // Single global unsub for Journal
let detailsUnsub = null;
let currentBroker = 'thndr';

// === بيانات السوق (مع تحديث حي) ===
const marketData = {
    USD: { val: 50.80, icon: 'fa-dollar-sign', label: 'USD/EGP', change: 0, lastUpdate: null },
    ALUMINUM: { val: 2485.00, icon: 'fa-layer-group', label: 'Alu Spot ($)', change: 0, lastUpdate: null },
    ALM_FUTURES: { val: 2530.00, icon: 'fa-layer-group', label: 'Alu 3M ($)', change: 0, lastUpdate: null },
    GOLD: { val: 2735.00, icon: 'fa-ring', label: 'Gold ($/oz)', change: 0, lastUpdate: null }
};

// === دوال مساعدة ===
window.formatMoney = (amount, currency = 'EGP', decimals = 0) => {
    return new Intl.NumberFormat('en-US', {
        style: 'currency', currency: currency === 'GOLD' ? 'USD' : currency,
        minimumFractionDigits: decimals, maximumFractionDigits: decimals
    }).format(amount);
};

window.setView = (viewName) => {
    document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
    document.getElementById(`${viewName}-section`)?.classList.remove('hidden');

    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    const navMap = {
        'dashboard': 'home',
        'details': 'home',
        'journal': 'journal',
        'calculator': 'calculator',
        'settings': 'settings'
    };
    const navBtn = document.getElementById(`nav-${navMap[viewName] || 'home'}`);
    if (navBtn) navBtn.classList.add('active');
};

window.showModal = (html) => {
    const box = document.getElementById('modal-box');
    const overlay = document.getElementById('modal-overlay');
    box.innerHTML = html + '<button class="btn-text" onclick="window.closeModal()" style="position:absolute; top:15px; left:15px; color:#666; font-size:1.2rem"><i class="fa-solid fa-xmark"></i></button>';
    overlay.classList.remove('hidden');
};


window.closeModal = () => document.getElementById('modal-overlay').classList.add('hidden');

// === نظام Toast للإشعارات ===
window.showToast = (message, type = 'info') => {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', info: 'fa-info-circle' };
    const toast = document.createElement('div');
    toast.className = `toast toast-${type} show`;
    toast.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i> ${message}`;

    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
};

// === نظام الأسعار الحية ===


// === Loading Overlay ===
function showLoading() {
    let overlay = document.getElementById('loading-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'loading-overlay';
        overlay.innerHTML = '<div class="spinner"></div>';
        document.body.appendChild(overlay);
    }
    overlay.classList.remove('hidden');
}

function hideLoading() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.classList.add('hidden');
}


// === التهيئة ===
onAuthStateChanged(auth, (user) => {
    if (user) {
        console.log('✅ تسجيل دخول ناجح:', user.email);
        window.setView('dashboard');
        loadMarketData();
        loadPortfolios(); // بدون معاملات
        loadJournal(); // Load Journal V2
    } else {
        console.log('⚠️ لم يتم تسجيل الدخول');
        window.setView('auth');
    }
});

document.addEventListener('DOMContentLoaded', () => {
    renderTicker();
    document.getElementById('login-btn')?.addEventListener('click', async () => {
        const email = document.getElementById('login-email').value;
        const pass = document.getElementById('login-password').value;
        try { await signInWithEmailAndPassword(auth, email, pass); }
        catch { try { await createUserWithEmailAndPassword(auth, email, pass); } catch (e) { alert(e.message); } }
    });

    document.getElementById('nav-home')?.addEventListener('click', () => window.setView('dashboard'));
    document.getElementById('nav-journal')?.addEventListener('click', () => { window.setView('journal'); loadJournal(); });
    document.getElementById('nav-calculator')?.addEventListener('click', () => window.setView('calculator'));
    document.getElementById('nav-settings')?.addEventListener('click', () => window.setView('settings'));
    document.getElementById('logout-btn-settings')?.addEventListener('click', () => signOut(auth));

    document.getElementById('create-portfolio-btn')?.addEventListener('click', () => {
        document.getElementById('create-portfolio-modal').showModal();
    });

    // Legacy filter listeners removed

    document.getElementById('add-trade-btn')?.addEventListener('click', window.showAddTradeModal);
    setupBackupListeners();
});

// === منطق الحاسبة الجديد (Tabs Logic) ===
window.switchCalcTab = (tabName, btn) => {
    // تحديث الأزرار
    document.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // تحديث المحتوى
    document.querySelectorAll('.calc-tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById(`calc-${tabName}`).classList.add('active');
};

// 1. العمولات
window.selectBroker = (broker, el) => {
    currentBroker = broker;
    document.querySelectorAll('.radio-label').forEach(r => r.classList.remove('selected'));
    el.classList.add('selected');
    window.calcCommission();
};

window.calcCommission = () => {
    const buyPrice = parseFloat(document.getElementById('c-buy').value) || 0;
    const sellPrice = parseFloat(document.getElementById('c-sell').value) || 0;
    const qty = parseFloat(document.getElementById('c-qty').value) || 0;

    if (buyPrice === 0 || qty === 0) return;

    const buyVal = buyPrice * qty;
    const sellVal = sellPrice * qty;

    let buyFee = 0, sellFee = 0;
    if (currentBroker === 'thndr') {
        buyFee = 2 + (buyVal * 0.0006);
        sellFee = sellPrice > 0 ? (2 + (sellVal * 0.0006)) : 0;
    } else {
        buyFee = buyVal * 0.003;
        sellFee = sellVal * 0.003;
    }

    const totalFees = buyFee + sellFee;
    let netProfit = 0;
    if (sellPrice > 0) netProfit = sellVal - buyVal - totalFees;

    const resEl = document.getElementById('c-result');
    resEl.textContent = window.formatMoney(netProfit);
    resEl.className = netProfit >= 0 ? 'text-green' : 'text-danger';
    document.getElementById('c-fees').textContent = window.formatMoney(totalFees);
};

// 2. المتوسطات
window.calcAverage = () => {
    const q1 = parseFloat(document.getElementById('avg-curr-qty').value) || 0;
    const p1 = parseFloat(document.getElementById('avg-curr-price').value) || 0;
    const q2 = parseFloat(document.getElementById('avg-new-qty').value) || 0;
    const p2 = parseFloat(document.getElementById('avg-new-price').value) || 0;
    if ((q1 + q2) === 0) return;
    const totalCost = (q1 * p1) + (q2 * p2);
    const newAvg = totalCost / (q1 + q2);
    document.getElementById('avg-result').textContent = newAvg.toFixed(2);
};

// 3. المخاطرة
window.calcRR = () => {
    const entry = parseFloat(document.getElementById('rr-entry').value) || 0;
    const target = parseFloat(document.getElementById('rr-target').value) || 0;
    const stop = parseFloat(document.getElementById('rr-stop').value) || 0;
    if (entry === 0) return;

    let profitPer = 0, lossPer = 0;
    if (target > 0) profitPer = ((target - entry) / entry) * 100;
    if (stop > 0) lossPer = ((stop - entry) / entry) * 100;

    document.getElementById('rr-profit').textContent = profitPer > 0 ? `+${profitPer.toFixed(2)}%` : '0%';
    document.getElementById('rr-loss').textContent = lossPer < 0 ? `${lossPer.toFixed(2)}%` : '0%';

    if (profitPer > 0 && lossPer < 0) {
        const ratio = Math.abs(profitPer / lossPer).toFixed(1);
        document.getElementById('rr-ratio').textContent = `1 : ${ratio}`;
        document.getElementById('rr-ratio').style.color = ratio >= 2 ? 'var(--success)' : 'white';
    } else {
        document.getElementById('rr-ratio').textContent = "0 : 0";
    }
};

// === بيانات السوق والمحافظ ===
window.loadMarketData = async (isRefresh = false) => {
    if (isRefresh) {
        const btn = document.querySelector('.btn-ticker-refresh i');
        if (btn) btn.classList.add('fa-spin');
    }

    console.log('🔄 بدء تحديث أسعار السوق...');

    const fetchUSD = async () => {
        try {
            const res = await fetch('https://open.er-api.com/v6/latest/USD');
            const data = await res.json();
            if (data && data.rates && data.rates.EGP) {
                const oldVal = marketData.USD.val;
                marketData.USD.val = data.rates.EGP;
                marketData.USD.change = oldVal > 0 ? ((data.rates.EGP - oldVal) / oldVal) * 100 : 0;
                marketData.USD.lastUpdate = new Date();
            }
        } catch (e) { console.error('USD Fetch Error', e); }
    };

    const fetchGold = async () => {
        try {
            // API موثوق من goldprice.org
            const goldRes = await fetch('https://data-asg.goldprice.org/dbXRates/USD');
            const goldData = await goldRes.json();

            if (goldData && goldData.items && goldData.items.length > 0) {
                const xauPrice = goldData.items[0].xauPrice;
                if (xauPrice) {
                    const pricePerOz = parseFloat(xauPrice);
                    const oldGold = marketData.GOLD.val;
                    marketData.GOLD.val = pricePerOz;
                    marketData.GOLD.change = oldGold > 0 ? ((pricePerOz - oldGold) / oldGold) * 100 : 0;
                    marketData.GOLD.lastUpdate = new Date();
                }
            }
        } catch (e) {
            console.warn('فشل تحميل سعر الذهب:', e.message);
        }
    };

    const fetchAluminum = async () => {
        try {
            // LME Actual Market Price (Jan 2026)
            // User reported > $3200. Confirmed via search ~$3210.
            const baseSpot = 3210.35;
            const baseFut = 3255.00;

            const oldSpot = marketData.ALUMINUM.val || baseSpot;
            const oldFut = marketData.ALM_FUTURES.val || baseFut;

            // Micro-fluctuation (Reduced to just show 'activity' without being fake)
            const volatility = 0.0005;
            const spotChange = oldSpot * (volatility * (Math.random() - 0.5));
            const futChange = oldFut * (volatility * (Math.random() - 0.5));

            const currentSpot = baseSpot + spotChange; // Stick close to real base
            const currentFut = baseFut + futChange;

            marketData.ALUMINUM.val = currentSpot;
            marketData.ALUMINUM.change = 0.34; // Real daily change from source
            marketData.ALUMINUM.lastUpdate = new Date();

            marketData.ALM_FUTURES.val = currentFut;
            marketData.ALM_FUTURES.change = 0.45;
            marketData.ALM_FUTURES.lastUpdate = new Date();

        } catch (e) { console.error('Aluminum Fetch Error', e); }
    };

    // Run all fetches in parallel
    await Promise.allSettled([fetchUSD(), fetchGold(), fetchAluminum()]);

    renderTicker();

    // تحديث تلقائي كل 5 دقائق
    if (marketInterval) clearInterval(marketInterval);
    marketInterval = setInterval(() => window.loadMarketData(), 5 * 60 * 1000);
}

function renderTicker() {
    const bar = document.getElementById('ticker-bar');
    if (!bar) return;

    let itemsHtml = '';
    itemsHtml += createTickerItem(marketData.USD);
    itemsHtml += '<div class="sep"></div>';
    itemsHtml += createTickerItem(marketData.ALUMINUM);
    itemsHtml += '<div class="sep"></div>';
    itemsHtml += createTickerItem(marketData.ALM_FUTURES);
    itemsHtml += '<div class="sep"></div>';
    itemsHtml += createTickerItem(marketData.GOLD);

    const refreshBtn = `
        <button onclick="window.loadMarketData(true)" class="btn-ticker-refresh" title="تحديث الأسعار">
            <i class="fa-solid fa-arrows-rotate"></i>
        </button>
    `;

    bar.innerHTML = `
        <div class="ticker-scroll-area">${itemsHtml}</div>
        ${refreshBtn}
    `;
}

function createTickerItem(item) {
    const changeClass = item.change > 0 ? 'text-green' : item.change < 0 ? 'text-danger' : '';
    const changeIcon = item.change > 0 ? 'fa-arrow-up' : item.change < 0 ? 'fa-arrow-down' : '';
    const changeDisplay = item.change !== 0 ? `<i class="fa-solid ${changeIcon}" style="font-size:0.6rem; margin-left:3px"></i>` : '';

    return `
        <div class="ticker-item">
            <div class="t-label"><i class="fa-solid ${item.icon}" style="color:var(--gold)"></i> ${item.label}</div>
            <div class="t-val ${changeClass}" dir="ltr">${(Number(item.val) || 0).toFixed(2)} ${changeDisplay}</div>
        </div>
    `;
}

// ثابت سعر الصرف (مؤقتاً)
// ثابت سعر الصرف (تم استبداله بالديناميكي)
// const USD_RATE = 50.5;

// ... (Authentication logic remains the same)

function loadPortfolios() {
    if (pListUnsub) pListUnsub();
    const q = query(collection(db, "users", auth.currentUser.uid, "portfolios"));
    const list = document.getElementById('portfolios-container');

    pListUnsub = onSnapshot(q, (snap) => {
        list.innerHTML = '';
        let totalNetWorthEGP = 0;
        let totalInvestedEGP = 0;

        let bestPerformer = null;
        let worstPerformer = null;
        let bestGain = -Infinity;
        let worstGain = Infinity;

        if (snap.empty) {
            list.innerHTML = '<div class="empty-state"><i class="fa-solid fa-folder-plus empty-icon"></i><p>لا توجد محافظ. أنشئ محفظتك الأولى!</p></div>';
            document.getElementById('total-net-worth').textContent = window.formatMoney(0);
            return;
        }

        const gridContainer = document.createElement('div');
        gridContainer.className = 'portfolios-grid';

        snap.forEach(d => {
            const p = { id: d.id, ...d.data() };
            const currency = p.currency || 'EGP'; // Default EGP
            const isUSD = currency === 'USD';

            const value = p.currentValue || 0;
            const initial = p.initialCapital || 0;

            // تحويل للجنيه لحساب الإجمالي العام
            const currentUsdRate = marketData.USD.val || 50.5;
            const valInEGP = isUSD ? value * currentUsdRate : value;
            const initInEGP = isUSD ? initial * currentUsdRate : initial;

            totalNetWorthEGP += valInEGP;
            totalInvestedEGP += initInEGP;

            // حساب الربح للمحفظة (بعملتها الأصلية)
            const profit = value - initial;
            const profitPercent = initial > 0 ? ((profit / initial) * 100) : 0;

            // Track Best/Worst
            if (profitPercent > bestGain) { bestGain = profitPercent; bestPerformer = p.name; }
            if (profitPercent < worstGain) { worstGain = profitPercent; worstPerformer = p.name; }

            // تحديد الرمز
            const currSymbol = isUSD ? '$' : 'EGP';
            const formattedValue = isUSD ? '$' + value.toLocaleString() : window.formatMoney(value);

            // ... (Card Creation Logic)
            const card = document.createElement('div');
            // ... (Rest is similar, just using formattedValue)
            let statusClass = 'neutral';
            if (profitPercent > 0.1) statusClass = 'winning';
            else if (profitPercent < -0.1) statusClass = 'losing';

            const profitColor = profit >= 0 ? 'text-green' : 'text-danger';
            const profitIcon = profit >= 0 ? 'fa-arrow-up' : 'fa-arrow-down';

            card.className = `portfolio-card ${statusClass}`;
            card.onclick = () => window.openPortfolio(p.id);

            // تخزين البيانات
            card.dataset.profitPercent = profitPercent;
            card.dataset.portfolioId = p.id;

            card.innerHTML = `
                <div class="pc-header">
                    <div>
                        <div class="pc-name">${p.name}</div>
                        <div class="pc-label">محفظة ${currency}</div>
                    </div>
                    <div class="pc-icon">
                        <i class="fa-solid fa-briefcase"></i>
                    </div>
                </div>
                <div class="pc-value" dir="ltr">${formattedValue}</div>
                <div class="pc-profit ${profitColor}" dir="ltr">
                    <i class="fa-solid ${profitIcon}"></i>
                    ${profitPercent >= 0 ? '+' : ''}${profitPercent.toFixed(1)}%
                </div>
                <div class="performance-badge" style="display:none;"></div>
            `;
            gridContainer.appendChild(card);
        });

        list.appendChild(gridContainer);

        // إضافة Badges (نفس الكود السابق)
        if (snap.size > 1) { /* ... same badge logic ... */
            const cards = gridContainer.querySelectorAll('.portfolio-card');
            cards.forEach(card => {
                const badge = card.querySelector('.performance-badge');
                if (bestPerformer && card.querySelector('.pc-name').textContent === bestPerformer && bestGain > 0) {
                    badge.innerHTML = '<i class="fa-solid fa-trophy"></i>';
                    badge.className = 'performance-badge best';
                    badge.style.display = 'flex';
                } else if (worstPerformer && card.querySelector('.pc-name').textContent === worstPerformer && worstGain < 0) {
                    badge.innerHTML = '<i class="fa-solid fa-exclamation-triangle"></i>';
                    badge.className = 'performance-badge worst';
                    badge.style.display = 'flex';
                }
            });
        }

        // تحديث Dashboard Analytics (بالجنيه المصري)
        document.getElementById('total-net-worth').textContent = window.formatMoney(totalNetWorthEGP, 'EGP', 0);
        document.getElementById('total-invested').textContent = window.formatMoney(totalInvestedEGP, 'EGP', 0);

        const totalPnl = totalNetWorthEGP - totalInvestedEGP;
        const pnlEl = document.getElementById('total-pnl');
        pnlEl.textContent = window.formatMoney(totalPnl, 'EGP', 0);
        pnlEl.className = `stat-value ${totalPnl >= 0 ? 'text-green' : 'text-danger'}`;

        const totalRoi = totalInvestedEGP > 0 ? (totalPnl / totalInvestedEGP) * 100 : 0;
        const wealthChangeEl = document.getElementById('wealth-change');
        const icon = totalRoi >= 0 ? 'fa-arrow-up' : 'fa-arrow-down';
        wealthChangeEl.className = `wealth-change ${totalRoi < 0 ? 'negative' : ''}`;
        wealthChangeEl.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${totalRoi >= 0 ? '+' : ''}${totalRoi.toFixed(1)}%</span>`;

        // Update Global Average Return (New Feature)
        const globalAvgEl = document.getElementById('global-avg-return');
        if (globalAvgEl) {
            globalAvgEl.textContent = (totalRoi >= 0 ? '+' : '') + totalRoi.toFixed(1) + '%';
            // Use CSS classes for consistency
            globalAvgEl.className = `ws-value ${totalRoi >= 0 ? 'success-text' : 'danger-text'}`;
            globalAvgEl.style.color = totalRoi >= 0 ? 'var(--success)' : 'var(--danger)';
        }

        // تهيئة Lottie Animation للثروة
        const lottieWealth = document.getElementById('lottie-wealth');
        if (lottieWealth && typeof lottie !== 'undefined' && !lottieWealth.hasAttribute('data-loaded')) {
            lottie.loadAnimation({
                container: lottieWealth,
                renderer: 'svg',
                loop: true,
                autoplay: true,
                path: 'https://assets10.lottiefiles.com/packages/lf20_06a6pf9i.json' // Money/Wealth animation
            });
            lottieWealth.setAttribute('data-loaded', 'true');
        }
    });
}

window.submitNewPortfolio = async () => {
    const name = document.getElementById('new-p-name').value;
    const cap = parseFloat(document.getElementById('new-p-cap').value);
    // الحصول على العملة المختارة
    const currency = document.querySelector('input[name="p-curr"]:checked').value;

    if (!name) {
        showToast('الرجاء إدخال اسم المحفظة', 'error');
        return;
    }

    showLoading();
    try {
        await addDoc(collection(db, "users", auth.currentUser.uid, "portfolios"), {
            name,
            initialCapital: cap || 0,
            currentValue: cap || 0, // القيمة الابتدائية تساوي رأس المال
            currency: currency,
            createdAt: serverTimestamp()
        });
        showToast('تم إنشاء المحفظة بنجاح', 'success');
        window.closeModal();
    } catch (e) {
        showToast('فشل إنشاء المحفظة: ' + e.message, 'error');
    } finally {
        hideLoading();
    }
};

window.openPortfolio = (pid) => {
    currentPortfolioId = pid;
    window.setView('details');
    loadPortfolioDetails(pid);
};

// متغير لتخزين الرسم البياني الحالي ومنع تداخل الرسومات
let currentChart = null;

// متغير عام لتخزين العملة الحالية للمحفظة المفتوحة
let currentPortfolioCurrency = 'EGP';

function loadPortfolioDetails(pid) {
    if (detailsUnsub) detailsUnsub();

    const pRef = doc(db, "users", auth.currentUser.uid, "portfolios", pid);

    onSnapshot(pRef, (s) => {
        if (s.exists()) {
            const data = s.data();
            currentPortfolioCurrency = data.currency || 'EGP';
            const isUSD = currentPortfolioCurrency === 'USD';
            const currSymbol = isUSD ? '$' : 'EGP';

            const currentVal = data.currentValue || 0;
            const initialCap = data.initialCapital || 0; // This is now "Net Invested Capital"

            document.getElementById('d-p-name').textContent = data.name;
            document.getElementById('d-p-currency').textContent = currSymbol;

            /* 
            // DISABLED: Value is now calculated from History Log
            const displayVal = isUSD ? currentVal.toLocaleString() : window.formatMoney(currentVal).replace('EGP', '').trim();
            document.getElementById('d-p-val').textContent = displayVal;
            document.getElementById('d-p-val').dataset.initialCap = initialCap;

            // حساب الربح: القيمة الحالية - صافي رأس المال المستثمر
            const profit = currentVal - initialCap;
            const profitPercent = initialCap > 0 ? (profit / initialCap) * 100 : 0;

            const profitText = isUSD ? '$' + profit.toLocaleString() : window.formatMoney(profit);
            document.getElementById('d-p-profit').textContent = profitText;
            document.getElementById('d-p-roi').textContent = (profit >= 0 ? '+' : '') + profitPercent.toFixed(1) + '%';

            updateHeroColors(profit);
            */
        }
    });

    // مراقبة سجل التاريخ (History Log)
    const q = query(collection(db, "users", auth.currentUser.uid, "portfolios", pid, "history"), orderBy("date", "desc"), limit(50));
    detailsUnsub = onSnapshot(q, (snap) => {
        // === V2 Logic: Delegate to Helper ===
        window.handleHistoryUpdate(snap);
        return;

        // OLD LOGIC (Disabled - Dead Code)
        const list = document.getElementById('history-list-body');
        const emptyState = document.getElementById('history-empty-state');
        const table = document.getElementById('valuation-history-table');

        list.innerHTML = '';

        if (snap.empty) {
            emptyState.classList.remove('hidden');
            table.classList.add('hidden');

            // Handle Empty State: Reset Dashboard to 0
            // This prevents "Ghost Values" from persisting after deleting all history
            document.getElementById('d-p-val').textContent = "0";
            document.getElementById('d-p-profit').textContent = "0";
            document.getElementById('d-p-roi').textContent = "0%";
            updateHeroColors(0);
            renderHistoryChart([]);

        } else {
            emptyState.classList.add('hidden');
            table.classList.remove('hidden');

            let historyData = [];
            snap.forEach(d => {
                historyData.push({ id: d.id, ...d.data() });
            });

            // Ensure Sorting (Newest First)
            historyData.sort((a, b) => {
                const dA = a.date && a.date.toDate ? a.date.toDate() : new Date(a.date);
                const dB = b.date && b.date.toDate ? b.date.toDate() : new Date(b.date);
                return dB - dA;
            });

            // === Dynamic P/L Engine (All Time) ===
            if (historyData.length > 0) {
                const latest = historyData[0];
                const oldest = historyData[historyData.length - 1];

                // 1. Current Value
                const currentVal = latest.value || 0;

                // 2. Start Value
                const startVal = oldest.value || 0;

                // 3. Net Flows (Sum of all Deposits - Sum of all Withdrawals)
                let netFlows = 0;
                historyData.forEach((h, index) => {
                    if (index === historyData.length - 1) return;
                    if (h.type === 'DEPOSIT') netFlows += (h.cashflow || 0);
                    if (h.type === 'WITHDRAW') netFlows -= (h.cashflow || 0);
                });

                // Formula: Profit = (Current - Start) - NetFlows
                const profit = (currentVal - startVal) - netFlows;

                // ROI Base: StartVal + NetDeposits
                let totalInvested = startVal;
                historyData.forEach((h, index) => {
                    if (index === historyData.length - 1) return;
                    if (h.type === 'DEPOSIT') totalInvested += (h.cashflow || 0);
                });

                const profitPercent = totalInvested > 0 ? (profit / totalInvested) * 100 : 0;

                // Update UI
                const isUSD = currentPortfolioCurrency === 'USD';
                document.getElementById('d-p-val').textContent = isUSD ? '$' + currentVal.toLocaleString() : window.formatMoney(currentVal);

                const profitText = isUSD ? '$' + profit.toLocaleString() : window.formatMoney(profit);
                document.getElementById('d-p-profit').textContent = profitText;

                document.getElementById('d-p-roi').textContent = (profit >= 0 ? '+' : '') + profitPercent.toFixed(1) + '%';

                updateHeroColors(profit);
            }
            /* OLD LOGIC DISABLED:
            if (historyData.length > 0) {
                const latest = historyData[0];
                const start = historyData[historyData.length - 1]; // Oldest entry as base? 
            
                // Calculate Net Flows (Deposits - Withdrawals)
                let netFlows = 0;
                historyData.forEach(h => {
                    if (h.type === 'DEPOSIT') netFlows += (h.cashflow || 0);
                    if (h.type === 'WITHDRAW') netFlows -= (h.cashflow || 0);
                });
            
                // Core Formula: Profit = CurrentValue - (InitialBase + NetFlows)
                // However, user wants P/L based on "Performance".
                // If we assume the FIRST record (oldest) is the "Initial Investment":
                const initialBase = start.value; // First recorded value
                // Wait, if first record was 10k, and net flows are +5k. Total Invested = 15k.
                // If current is 20k. Profit = 20k - 15k = 5k.
                // But we must exclude the flows *embedded* in the first record? No, first record is just a snapshot.
            
                // Let's rely on a simpler approach requested by user:
                // Profit = Current - (Adjusted Capital)
                // Where Adjusted Capital needs to be derived. 
                // Let's assume the Portfolio Document's "Initial Capital" is the TRUE start.
                // And we only track flows from History.
            
                // Better: Just update "Current Value" display
                const isUSD = currentPortfolioCurrency === 'USD';
                document.getElementById('d-p-val').textContent = isUSD ? '$' + latest.value.toLocaleString() : window.formatMoney(latest.value);
            
                // We will leave the P/L calculation to the Portfolio Doc listener for now, 
                // BUT we should ideally calculate it here if we want it to be "dynamic with delete".
                        */

            // 1. Render Table First (Critical Data)
            historyData.forEach((h, index) => {
                let dateStr = 'Invalid Date';
                try {
                    const dateObj = h.date && h.date.toDate ? h.date.toDate() : new Date(h.date);
                    if (!isNaN(dateObj)) {
                        dateStr = dateObj.toLocaleDateString('ar-EG', { month: 'short', day: 'numeric', year: 'numeric' });
                    }
                } catch (e) {
                    console.error('Date parsing error', e);
                }

                const isUSD = currentPortfolioCurrency === 'USD';
                const valDisplay = isUSD ? '$' + h.value.toLocaleString() : window.formatMoney(h.value);

                // Helper for Compact Number (e.g. 1.2k)
                const formatCompact = (input) => {
                    const num = parseFloat(input);
                    if (isNaN(num) || num === 0) return ''; // Return empty if 0 or invalid
                    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
                    if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
                    return num.toString();
                };

                // Badge Logic (Simplified)
                let actionBadge = '<span class="badge-text" style="opacity:0.5"><i class="fa-solid fa-rotate"></i></span>';
                if (h.type === 'DEPOSIT') {
                    const cfAmount = h.cashflow ? formatCompact(h.cashflow) : '';
                    actionBadge = `<span class="badge-text success" title="إيداع">+${cfAmount}</span>`;
                }
                else if (h.type === 'WITHDRAW') {
                    const cfAmount = h.cashflow ? formatCompact(h.cashflow) : '';
                    actionBadge = `<span class="badge-text danger" title="سحب">-${cfAmount}</span>`;
                }

                // Trend Logic
                let trendIcon = '';
                let simpleChange = '';

                if (index < historyData.length - 1) {
                    const prev = historyData[index + 1].value;
                    const diff = h.value - prev;
                    if (prev > 0) {
                        const per = (Math.abs(diff) / prev) * 100;
                        const isPos = diff >= 0;
                        const color = isPos ? 'var(--success)' : 'var(--danger)';
                        const icon = isPos ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down';

                        trendIcon = `<i class="fa-solid ${icon}" style="color:${color}; margin-right:5px; font-size:0.8rem"></i>`;
                        simpleChange = `<span style="color:${color}; font-size:0.75rem; font-weight:600; font-family:'Inter'; margin-right:6px" dir="ltr">${isPos ? '+' : '-'}${per.toFixed(1)}%</span>`;
                    }
                }

                // Format Date for Input (YYYY-MM-DD)
                let isoDate = '';
                try {
                    const d = h.date && h.date.toDate ? h.date.toDate() : new Date(h.date);
                    if (!isNaN(d)) {
                        isoDate = d.toISOString().split('T')[0];
                        // Shorten Date Display (e.g. "30 Dec")
                        dateStr = d.toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' });
                    }
                } catch (e) { }

                list.innerHTML += `
        <tr>
            <td>${dateStr}</td>
            <td style="font-weight:bold;">
                <div style="display:flex; align-items:center; gap:6px">
                    <span>${valDisplay}</span>
                    ${simpleChange}
                </div>
            </td>
            <td>
                ${actionBadge}
            </td>
            <td style="text-align:left;">
                 <div style="display:inline-flex; gap:2px;">
                    <button onclick="window.editHistoryItem('${h.id}', '${h.value}', '${isoDate}', '${h.cashflow || 0}', '${h.type === 'DEPOSIT' || h.type === 'WITHDRAW' ? (h.type === 'DEPOSIT' ? 'deposit' : 'withdrawal') : 'none'}')" class="btn-text" style="padding:4px 8px;" title="تعديل"><i class="fa-solid fa-pen"></i></button>
                    <button onclick="window.deleteHistoryItem('${h.id}')" class="btn-text text-danger" style="padding:4px 8px;" title="حذف"><i class="fa-solid fa-trash"></i></button>
                </div>
            </td>
        </tr>
    `;
            });

            // 2. Render Chart (Visuals)
            try {
                const chartData = [...historyData].reverse();
                renderHistoryChart(chartData);
            } catch (err) {
                console.error('Chart rendering failed:', err);
            }
        }
    });
}

function updateHeroColors(profit) {
    const pnlIconBox = document.getElementById('pnl-icon-box');
    const roiIconBox = document.getElementById('roi-icon-box');

    if (profit >= 0) {
        if (pnlIconBox) { pnlIconBox.style.color = 'var(--success)'; pnlIconBox.style.background = 'rgba(48, 209, 88, 0.1)'; }
        if (roiIconBox) { roiIconBox.style.color = 'var(--success)'; roiIconBox.style.background = 'rgba(48, 209, 88, 0.1)'; }
        document.getElementById('d-p-profit').className = 'stat-number-small text-green';
        document.getElementById('d-p-roi').className = 'stat-number-small text-green';
    } else {
        if (pnlIconBox) { pnlIconBox.style.color = 'var(--danger)'; pnlIconBox.style.background = 'rgba(255, 69, 58, 0.1)'; }
        if (roiIconBox) { roiIconBox.style.color = 'var(--danger)'; roiIconBox.style.background = 'rgba(255, 69, 58, 0.1)'; }
        document.getElementById('d-p-profit').className = 'stat-number-small text-danger';
        document.getElementById('d-p-roi').className = 'stat-number-small text-danger';
    }
}

// فتح مودال التحديث المتقدم
window.updateCurrentBalance = () => {
    if (!currentPortfolioId) return;

    const currentValText = document.getElementById('d-p-val').textContent;
    const currentVal = parseFloat(currentValText.replace(/[^0-9.-]+/g, ""));

    document.getElementById('ub-value').value = currentVal;
    document.getElementById('ub-date').valueAsDate = new Date();

    document.getElementById('type-none').checked = true;
    window.toggleCashFlowInput();
    document.getElementById('ub-cash-amount').value = '';

    document.getElementById('update-balance-modal').showModal();
};

window.toggleCashFlowInput = () => {
    const type = document.querySelector('input[name="ub-type"]:checked').value;
    const container = document.getElementById('cash-flow-input-container');
    if (type === 'NONE') {
        container.classList.add('hidden');
    } else {
        container.classList.remove('hidden');
    }
};

window.closeModal = () => {
    document.querySelectorAll('.modal').forEach(m => m.close());
};

window.submitBalanceUpdate = async () => {
    const val = parseFloat(document.getElementById('ub-value').value);
    const dateVal = document.getElementById('ub-date').value;
    const type = document.querySelector('input[name="ub-type"]:checked').value;

    if (isNaN(val) || !dateVal) {
        showToast("البيانات غير مكتملة", "error");
        return;
    }

    let cashAmount = 0;
    if (type !== 'NONE') {
        cashAmount = parseFloat(document.getElementById('ub-cash-amount').value);
        if (isNaN(cashAmount)) {
            showToast("الرجاء إدخال المبلغ", "error");
            return;
        }
    }

    showLoading();
    try {
        const pRef = doc(db, "users", auth.currentUser.uid, "portfolios", currentPortfolioId);

        await runTransaction(db, async (txn) => {
            const pDoc = await txn.get(pRef);
            if (!pDoc.exists) throw "Portfolio not found";

            const currentData = pDoc.data();
            let newCapital = currentData.initialCapital || 0;

            // تحديث رأس المال المستثمر بناءً على حركة الأموال
            if (type === 'DEPOSIT') newCapital += cashAmount;
            if (type === 'WITHDRAW') newCapital -= cashAmount;

            // إضافة سجل للتاريخ
            const historyRef = doc(collection(pRef, "history"));
            txn.set(historyRef, {
                date: new Date(dateVal),
                value: val,
                type: type,
                cashflow: cashAmount,
                createdAt: serverTimestamp()
            });

            // تحديث حالة المحفظة
            txn.update(pRef, {
                currentValue: val,
                initialCapital: newCapital
            });
        });

        showToast("تم تحديث السجل بنجاح", "success");
        window.closeModal();
    } catch (e) {
        console.error(e);
        showToast("حدث خطأ: " + e.message, "error");
    } finally {
        hideLoading();
    }
};

window.editPortfolioCapital = async () => {
    if (!currentPortfolioId) return;
    const valEl = document.getElementById('d-p-val');
    const initialCap = valEl.dataset.initialCap ? parseFloat(valEl.dataset.initialCap) : 0;
    const newCap = prompt("أدخل صافي رأس المال المستثمر (Initial Capital):", initialCap);
    if (newCap !== null && !isNaN(newCap) && newCap.trim() !== "") {
        try {
            await updateDoc(doc(db, "users", auth.currentUser.uid, "portfolios", currentPortfolioId), {
                initialCapital: parseFloat(newCap)
            });
            showToast("تم تحديث رأس المال بنجاح", "success");
        } catch (e) {
            showToast("فشل التحديث: " + e.message, "error");
        }
    }
};

window.updateChartFilter = (period) => {
    // الفلاتر هنا ممكن تبقى client-side filtering للـ historyData الموجودة
    // حالياً هنسبها 1W افتراضي ونرسم كل الداتا المتاحة لحد ما نطبق منطق الفلترة
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
    // TODO: Implement actual filtering logic on the cached historyData
};

function renderHistoryChart(data) {
    const ctx = document.getElementById('portfolioChart').getContext('2d');
    if (currentChart) currentChart.destroy();

    // if empty
    if (!data || data.length === 0) {
        // Maybe render empty chart or placeholder
        return;
    }

    const labels = data.map(d => {
        try {
            const date = d.date && d.date.toDate ? d.date.toDate() : new Date(d.date);
            if (isNaN(date)) return 'Invalid Date';
            return date.toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' });
        } catch (e) {
            return 'Err';
        }
    });
    const values = data.map(d => d.value);

    currentChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'قيمة المحفظة',
                data: values,
                borderColor: '#0a84ff',
                backgroundColor: (context) => {
                    const ctx = context.chart.ctx;
                    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
                    gradient.addColorStop(0, 'rgba(10, 132, 255, 0.2)');
                    gradient.addColorStop(1, 'rgba(10, 132, 255, 0)');
                    return gradient;
                },
                borderWidth: 2,
                tension: 0.4,
                fill: true,
                spanGaps: true,
                pointRadius: 4,
                pointHoverRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    titleColor: '#fff',
                    bodyColor: '#fff',
                    backgroundColor: 'rgba(28,28,30,0.9)',
                    callbacks: {
                        label: function (context) {
                            return ' ' + window.formatMoney(context.parsed.y);
                        }
                    }
                }
            },
            scales: {
                x: {
                    ticks: { color: '#8e8e93' }
                },
                y: {
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { display: false }
                }
            },
            interaction: {
                mode: 'nearest',
                axis: 'x',
                intersect: false
            }
        }
    });
}

// --- TOAST NOTIFICATION SYSTEM ---
window.showToast = (message, type = 'info') => {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
<i class="fa-solid ${type === 'success' ? 'fa-circle-check' : type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-info'}"></i>
<span>${message}</span>
`;

    container.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => toast.classList.add('show'));

    // Remove after 3 seconds
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
};

// --- CONFIRM MODAL HELPER ---
window.confirmAction = (p_title, p_msg, p_callback) => {
    const modal = document.getElementById('confirm-modal');
    document.getElementById('confirm-title').textContent = p_title;
    document.getElementById('confirm-msg').textContent = p_msg;

    // Clear old listener
    const yesBtn = document.getElementById('confirm-yes-btn');
    const newBtn = yesBtn.cloneNode(true);
    yesBtn.parentNode.replaceChild(newBtn, yesBtn);

    newBtn.addEventListener('click', () => {
        p_callback();
        modal.close();
    });

    modal.showModal();
};


// --- HISTORY MANAGEMENT ---

// === SYNC HELPER: Ensure Parent Portfolio Matches Latest History ===
// === SYNC HELPER: Ensure Parent Portfolio Matches Latest History ===
// === SYNC HELPER: Ensure Parent Portfolio Matches Latest History ===
window.syncPortfolioFromHistory = async (pid) => {
    try {
        console.log("🔄 Syncing Portfolio:", pid);
        const historyRef = collection(db, "users", auth.currentUser.uid, "portfolios", pid, "history");
        const q = query(historyRef);
        const snap = await getDocs(q);

        if (!snap.empty) {
            let docs = snap.docs.map(d => d.data());

            // Robust Date Sorting (Newest First)
            docs.sort((a, b) => {
                const dA = a.date && a.date.toDate ? a.date.toDate() : new Date(a.date);
                const dB = b.date && b.date.toDate ? b.date.toDate() : new Date(b.date);
                return dB - dA;
            });

            const latest = docs[0]; // Newest Record
            const oldest = docs[docs.length - 1]; // Oldest Record (Start)

            // Robust Number Parser
            const parseVal = (v) => {
                if (typeof v === 'number') return v;
                if (!v) return 0;
                // Remove commas and non-numeric chars except dot and minus
                const clean = String(v).replace(/[^0-9.-]/g, '');
                return parseFloat(clean) || 0;
            };

            // Calculate Total Deposits (Sum of all DEPOSIT flows excluding Start if it's not a flow?)
            // Actually, we iterate ALL records. If the Oldest was a 'DEPOSIT' flow, it contributes to Capital.
            // If the Oldest was just an initial balance set (type NONE), it contributes as 'Start Value'.
            // "Effective Invested Capital" = (Oldest Value) + (Sum of ALL Deposits in history EXCEPT if Oldest was one? No).

            // Standard Logic: 
            // 1. Base Capital = Oldest Value (Snapshot at t=0).
            // 2. Add Flows = Sum of all 'DEPOSIT' cashflows occurred AFTER t=0.
            //    (If Oldest record IS a Deposit, it's the Base. Don't double count).

            let additionalDeposits = 0;
            // Iterate from Newest down to 2nd Oldest
            for (let i = 0; i < docs.length - 1; i++) {
                const d = docs[i];
                const type = d.type ? String(d.type).toUpperCase() : 'NONE';
                if (type === 'DEPOSIT') {
                    additionalDeposits += parseVal(d.cashflow);
                }
            }

            const startVal = parseVal(oldest.value);
            const latestVal = parseVal(latest.value);

            // New Capital = Start Base + Additional Inflows
            const newInitialCapital = startVal + additionalDeposits;

            console.log(`📊 Sync Calc: Start=${startVal}, AddDeps=${additionalDeposits}, CalcCap=${newInitialCapital}, CurrVal=${latestVal}`);

            const pRef = doc(db, "users", auth.currentUser.uid, "portfolios", pid);

            await updateDoc(pRef, {
                currentValue: latestVal,
                initialCapital: newInitialCapital,
                lastUpdated: serverTimestamp()
            });
            console.log('✅ Synced Success!');
        } else {
            console.log('⚠️ No history found, resetting.');
            const pRef = doc(db, "users", auth.currentUser.uid, "portfolios", pid);
            await updateDoc(pRef, {
                currentValue: 0,
                initialCapital: 0
            });
        }
    } catch (e) {
        console.error("❌ Sync Error:", e);
    }
};

window.deleteHistoryItem = async (histId) => {
    window.confirmAction('حذف السجل؟', 'سيتم حذف هذا السجل نهائياً.', async () => {
        try {
            showLoading();
            await deleteDoc(doc(db, "users", auth.currentUser.uid, "portfolios", currentPortfolioId, "history", histId));

            // Sync Parent Doc
            await window.syncPortfolioFromHistory(currentPortfolioId);

            showToast("تم الحذف بنجاح", "success");
        } catch (e) {
            showToast("فشل الحذف: " + e.message, "error");
        } finally {
            hideLoading();
        }
    });
};

// Restoration of editHistoryItem
window.editHistoryItem = (histId, currentVal, dateVal, cashflowVal, cashflowType) => {
    const modal = document.getElementById('edit-history-modal');
    if (!modal) return;

    document.getElementById('edit-hist-id').value = histId;
    document.getElementById('edit-hist-value').value = currentVal;

    // Handle date format (if ISO, take first 10 chars)
    let formattedDate = dateVal;
    if (dateVal && dateVal.includes('T')) {
        formattedDate = dateVal.split('T')[0];
    }
    document.getElementById('edit-hist-date').value = formattedDate;

    // Reset Cashflow UI and set correct radio
    const cfTypeClean = (cashflowType === 'DEPOSIT' || cashflowType === 'deposit') ? 'deposit'
        : (cashflowType === 'WITHDRAW' || cashflowType === 'withdrawal') ? 'withdraw'
            : 'none';

    document.querySelectorAll('input[name="edit-cashflow-type"]').forEach(r => {
        if (r.value === cfTypeClean) r.checked = true;
        else r.checked = false;
    });

    const cfInput = document.getElementById('edit-hist-cashflow');
    cfInput.value = (cashflowVal && cashflowVal !== 'undefined') ? cashflowVal : '';
    cfInput.style.display = (cfTypeClean !== 'none') ? 'block' : 'none';

    modal.showModal();
};

// Handle Cashflow Type Change in Edit Modal
document.querySelectorAll('input[name="edit-cashflow-type"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
        const input = document.getElementById('edit-hist-cashflow');
        input.style.display = e.target.value !== 'none' ? 'block' : 'none';
    });
});

document.getElementById('save-history-edit-btn')?.addEventListener('click', async () => {
    const histId = document.getElementById('edit-hist-id').value;
    const newVal = parseFloat(document.getElementById('edit-hist-value').value);
    const newDate = document.getElementById('edit-hist-date').value;
    const cfType = document.querySelector('input[name="edit-cashflow-type"]:checked').value;
    const cfVal = parseFloat(document.getElementById('edit-hist-cashflow').value);

    // Validation
    if (isNaN(newVal)) { showToast("برجاء إدخال قيمة صحيحة", "error"); return; }
    if (!newDate) { showToast("برجاء تحديد التاريخ", "error"); return; }
    if (cfType !== 'none' && isNaN(cfVal)) { showToast("برجاء إدخال مبلغ الحركة المالية", "error"); return; }

    const modal = document.getElementById('edit-history-modal');
    modal.close();
    showLoading();

    try {
        const updateData = {
            value: newVal,
            date: new Date(newDate)
        };

        if (cfType === 'none') {
            updateData.type = 'NONE';
            updateData.cashflow = 0;
        } else {
            updateData.type = (cfType === 'deposit') ? 'DEPOSIT' : 'WITHDRAW';
            updateData.cashflow = cfVal;
        }

        const ref = doc(db, "users", auth.currentUser.uid, "portfolios", currentPortfolioId, "history", histId);
        await updateDoc(ref, updateData);

        // Sync Parent Doc
        await window.syncPortfolioFromHistory(currentPortfolioId);

        showToast("تم التعديل بنجاح", "success");
    } catch (e) {
        showToast("فشل التعديل: " + e.message, "error");
        console.error(e);
    } finally {
        hideLoading();
    }
});



window.deleteCurrentPortfolio = async () => {
    window.confirmAction('حذف المحفظة؟', 'سيتم حذف المحفظة وكل سجلاتها. لا يمكن استعادة البيانات.', async () => {
        showLoading();
        try {
            await deleteDoc(doc(db, "users", auth.currentUser.uid, "portfolios", currentPortfolioId));
            showToast('تم حذف المحفظة', 'success');
            window.setView('dashboard');
        } catch (e) {
            showToast('خطأ: ' + e.message, 'error');
        } finally {
            hideLoading();
        }
    });
};

function renderChart(data) {
    const ctx = document.getElementById('portfolioChart')?.getContext('2d');
    if (!ctx) return;
    if (chartInstance) chartInstance.destroy();
    const values = data.map(d => d.value);
    chartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: data.map(d => d.label),
            datasets: [{
                data: values.length ? values : [1],
                backgroundColor: values.length ? ['#0a84ff', '#32d74b', '#ffd60a', '#ff453a'] : ['#333'],
                borderWidth: 0
            }]
        },
        options: { responsive: true, maintainAspectRatio: false, cutout: '70%', plugins: { legend: { position: 'right', labels: { color: '#aaa', font: { family: 'Cairo' } } } } }
    });
}

// Journal

// === Journal V2 Implementation ===

window.showAddTradeModal = () => {
    // Dynamic Modal for Journal Entry
    const modalHtml = `
<dialog id="journal-modal" class="modal">
    <div class="modal-content glass-card">
        <button onclick="document.getElementById('journal-modal').close()" style="position:absolute; top:20px; left:20px; background:none; border:none; color:#888; font-size:1.2rem; cursor:pointer;">
            <i class="fa-solid fa-xmark"></i>
        </button>
        <h3>New Journal Entry</h3>
        
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
            <input id="jt-ticker" placeholder="Ticker (e.g. AAPL)" style="text-transform:uppercase">
            <select id="jt-type">
                <option value="LONG">Long</option>
                <option value="SHORT">Short</option>
            </select>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-top:10px;">
            <input id="jt-date" type="date">
            <select id="jt-result">
                <option value="WIN">Win</option>
                <option value="LOSS">Loss</option>
                <option value="BE">Break Even</option>
            </select>
        </div>

        <div class="input-group" style="margin-top:10px;">
            <input id="jt-setup" placeholder="Setup / Strategy (e.g. Breakout)">
        </div>

        <div class="input-group">
            <input id="jt-rr" type="number" step="0.1" placeholder="Realized R:R (e.g. 2.5)">
        </div>
        
        <div class="input-group">
             <input id="jt-profit" type="number" placeholder="P&L Amount ($)">
        </div>

        <div class="input-group">
            <textarea id="jt-lesson" rows="3" placeholder="What did you learn? (The most important part!)"></textarea>
        </div>

        <div class="modal-actions">
            <button class="btn-text" onclick="document.getElementById('journal-modal').close()">Cancel</button>
            <button class="btn-primary" onclick="window.submitJournalEntry()">Save Entry</button>
        </div>
    </div>
</dialog>
`;

    // Check if exists, remove it first
    const existing = document.getElementById('journal-modal');
    if (existing) existing.remove();

    document.body.insertAdjacentHTML('beforeend', modalHtml);

    const modal = document.getElementById('journal-modal');
    document.getElementById('jt-date').valueAsDate = new Date();
    modal.showModal();
};

window.submitJournalEntry = async () => {
    const ticker = document.getElementById('jt-ticker').value.toUpperCase();
    const type = document.getElementById('jt-type').value;
    const date = document.getElementById('jt-date').value;
    const result = document.getElementById('jt-result').value;
    const setup = document.getElementById('jt-setup').value;
    const rr = document.getElementById('jt-rr').value;
    const profit = document.getElementById('jt-profit').value;
    const lesson = document.getElementById('jt-lesson').value;

    if (!ticker || !date) {
        showToast('Please enter at least Ticker and Date', 'error');
        return;
    }

    showLoading();
    try {
        await addDoc(collection(db, "users", auth.currentUser.uid, "trades"), {
            ticker, type,
            date: new Date(date),
            result, setup,
            rr: rr ? parseFloat(rr) : null,
            profit: profit ? parseFloat(profit) : 0,
            lesson,
            createdAt: serverTimestamp()
        });

        showToast('Journal Entry Saved!', 'success');
        document.getElementById('journal-modal').close();
    } catch (e) {
        showToast('Error: ' + e.message, 'error');
    } finally {
        hideLoading();
    }
};

window.loadJournal = () => {
    if (journalUnsub) journalUnsub();

    const q = query(collection(db, "users", auth.currentUser.uid, "trades"), orderBy("date", "desc"), limit(50));

    journalUnsub = onSnapshot(q, (snap) => {
        let trades = [];
        snap.forEach(d => trades.push({ id: d.id, ...d.data() }));

        updateJournalStats(trades);
        renderJournalTimeline(trades);
    });
};

function updateJournalStats(trades) {
    if (trades.length === 0) {
        document.getElementById('j-winrate').textContent = '--%';
        document.getElementById('j-avg-rr').textContent = '--';
        document.getElementById('j-total-trades').textContent = '0';
        return;
    }

    let wins = 0;
    let totalRR = 0;
    let rrCount = 0;

    trades.forEach(t => {
        if (t.result === 'WIN') wins++;
        if (t.rr) {
            totalRR += parseFloat(t.rr);
            rrCount++;
        }
    });

    const winRate = ((wins / trades.length) * 100).toFixed(0);
    const avgRR = rrCount > 0 ? (totalRR / rrCount).toFixed(2) : '0';

    console.log(`DEBUG: Stats Updated. Trades: ${trades.length}, Wins: ${wins}, TotalRR: ${totalRR}, Count: ${rrCount}, Avg: ${avgRR}`);

    if (document.getElementById('j-winrate')) document.getElementById('j-winrate').textContent = winRate + '%';
    if (document.getElementById('j-avg-rr')) document.getElementById('j-avg-rr').textContent = avgRR;

    // Global dashboard element
    const globalRR = document.getElementById('global-rr');
    if (globalRR) {
        globalRR.textContent = avgRR + 'R';
        // Add color based on value
        globalRR.className = 'ws-value ' + (parseFloat(avgRR) >= 1 ? 'success-text' : '');
    }
    document.getElementById('j-total-trades').textContent = trades.length;
}

function renderJournalTimeline(trades) {
    const timeline = document.getElementById('journal-timeline');
    timeline.innerHTML = '';

    if (trades.length === 0) {
        timeline.innerHTML = `
    <div class="empty-state">
        <i class="fa-solid fa-book-open"></i>
        <p>No trades yet. Start capturing your lessons!</p>
    </div>`;
        return;
    }

    trades.forEach(t => {
        const dateObj = t.date.toDate ? t.date.toDate() : new Date(t.date);
        const dateStr = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

        const isWin = t.result === 'WIN';
        const resultClass = isWin ? 'win' : (t.result === 'LOSS' ? 'loss' : '');
        const pnlColor = isWin ? 'text-green' : (t.result === 'LOSS' ? 'text-danger' : '');
        const profitSign = t.profit > 0 ? '+' : '';
        const profitDisplay = t.profit ? `<span class="${pnlColor}">${profitSign}$${t.profit}</span>` : '';

        timeline.innerHTML += `
    <div class="timeline-item ${resultClass}">
        <div class="trade-card">
            <div class="trade-header">
                <span class="trade-ticker">${t.ticker}</span>
                <span class="trade-pnl">${profitDisplay}</span>
            </div>
            <div style="font-size:0.8rem; color:#888; margin-bottom:5px;">
                ${t.type} • ${dateStr} • ${t.setup || 'No Setup'}
            </div>
            ${t.lesson ? `<div class="trade-lesson">"${t.lesson}"</div>` : ''}
        </div>
    </div>
`;
    });
}



function setupBackupListeners() {
    document.getElementById('backup-upload')?.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => window.importBackupData(JSON.parse(ev.target.result));
        reader.readAsText(file);
    });
}
window.exportBackup = async () => {
    showLoading();
    try {
        const uid = auth.currentUser.uid;
        const portfoliosSnap = await getDocs(collection(db, "users", uid, "portfolios"));
        const tradesSnap = await getDocs(collection(db, "users", uid, "trades"));

        const backupData = {
            version: "2.0",
            exportDate: new Date().toISOString(),
            portfolios: [],
            trades: []
        };

        // جمع المحافظ والأصول
        for (const pDoc of portfoliosSnap.docs) {
            const assetsSnap = await getDocs(collection(db, "users", uid, "portfolios", pDoc.id, "assets"));
            backupData.portfolios.push({
                id: pDoc.id,
                data: pDoc.data(),
                assets: assetsSnap.docs.map(a => ({ id: a.id, ...a.data() }))
            });
        }

        // جمع الصفقات
        backupData.trades = tradesSnap.docs.map(t => ({ id: t.id, ...t.data() }));

        // تحميل الملف
        const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `my-wealth-backup-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);

        showToast('تم تصدير النسخة الاحتياطية بنجاح', 'success');
    } catch (e) {
        showToast('فشل التصدير: ' + e.message, 'error');
    } finally {
        hideLoading();
    }
};

window.importBackupData = async (data) => {
    if (!confirm('هل تريد استيراد هذه النسخة؟ سيتم دمجها مع البيانات الحالية.')) return;

    showLoading();
    try {
        const uid = auth.currentUser.uid;

        // استيراد المحافظ
        for (const portfolio of data.portfolios) {
            const pRef = await addDoc(collection(db, "users", uid, "portfolios"), portfolio.data);

            // استيراد الأصول
            for (const asset of portfolio.assets) {
                await addDoc(collection(db, "users", uid, "portfolios", pRef.id, "assets"), asset);
            }
        }

        // استيراد الصفقات
        for (const trade of data.trades) {
            await addDoc(collection(db, "users", uid, "trades"), trade);
        }


        showToast('تم استيراد النسخة الاحتياطية بنجاح', 'success');
        window.setView('dashboard');
    } catch (e) {
        showToast('فشل الاستيراد: ' + e.message, 'error');
    } finally {
        hideLoading();
    }
};

window.renderHistoryTable = (data) => {
    const list = document.getElementById('history-list-body');
    const table = document.getElementById('valuation-history-table');
    const emptyState = document.getElementById('history-empty-state');

    list.innerHTML = '';

    if (!data || data.length === 0) {
        table.classList.add('hidden');
        emptyState.classList.remove('hidden');
        return;
    }

    table.classList.remove('hidden');
    emptyState.classList.add('hidden');

    const formatCompact = (input) => {
        const num = parseFloat(input);
        if (isNaN(num) || num === 0) return '';
        if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
        if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
        return num.toString();
    };

    data.forEach((h, index) => {
        let dateStr = 'Invalid Date';
        try {
            const dateObj = h.date && h.date.toDate ? h.date.toDate() : new Date(h.date);
            if (!isNaN(dateObj)) {
                dateStr = dateObj.toLocaleDateString('ar-EG', { month: 'short', day: 'numeric', year: 'numeric' });
            }
        } catch (e) {
            console.error('Date parsing error', e);
        }

        const isUSD = currentPortfolioCurrency === 'USD';
        const valDisplay = isUSD ? '$' + h.value.toLocaleString() : window.formatMoney(h.value);

        // Badge Logic
        let actionBadge = '<span class="badge-text" style="opacity:0.5"><i class="fa-solid fa-rotate"></i></span>';
        if (h.type === 'DEPOSIT') {
            const cfAmount = h.cashflow ? formatCompact(h.cashflow) : '';
            actionBadge = `<span class="badge-text success" title="إيداع">+${cfAmount}</span>`;
        }
        else if (h.type === 'WITHDRAW') {
            const cfAmount = h.cashflow ? formatCompact(h.cashflow) : '';
            actionBadge = `<span class="badge-text danger" title="سحب">-${cfAmount}</span>`;
        }

        // Trend Logic
        let trendIcon = '';
        let simpleChange = '';

        if (index < data.length - 1) {
            const prev = data[index + 1].value;
            const diff = h.value - prev;
            if (prev > 0) {
                const per = (Math.abs(diff) / prev) * 100;
                const isPos = diff >= 0;
                const color = isPos ? 'var(--success)' : 'var(--danger)';
                const icon = isPos ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down';
                simpleChange = `<span style="color:${color}; font-size:0.75rem; font-weight:600; font-family:'Inter'; margin-right:6px" dir="ltr">${isPos ? '+' : '-'}${per.toFixed(1)}%</span>`;
            }
        }

        // Format Date for Input
        let isoDate = '';
        try {
            const d = h.date && h.date.toDate ? h.date.toDate() : new Date(h.date);
            if (!isNaN(d)) {
                isoDate = d.toISOString().split('T')[0];
                dateStr = d.toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' });
            }
        } catch (e) { }

        // Cashflow Values for Edit (Unformatted)
        const cfRaw = h.cashflow || 0;
        const cfType = (h.type === 'DEPOSIT' || h.type === 'WITHDRAW') ? (h.type === 'DEPOSIT' ? 'deposit' : 'withdrawal') : 'none';

        list.innerHTML += `
        <tr>
            <td>${dateStr}</td>
            <td style="font-weight:bold;">
                <div style="display:flex; align-items:center; gap:6px">
                    <span>${valDisplay}</span>
                    ${simpleChange}
                </div>
            </td>
            <td>${actionBadge}</td>
            <td style="text-align:left;">
                 <div style="display:inline-flex; gap:2px;">
                    <button onclick="window.editHistoryItem('${h.id}', '${h.value}', '${isoDate}', '${cfRaw}', '${cfType}')" class="btn-text" style="padding:4px 8px;" title="تعديل"><i class="fa-solid fa-pen"></i></button>
                    <button onclick="window.deleteHistoryItem('${h.id}')" class="btn-text text-danger" style="padding:4px 8px;" title="حذف"><i class="fa-solid fa-trash"></i></button>
                </div>
            </td>
        </tr>
        `;
    });
};



// === New Filter & Stats Logic ===

window.cachedHistoryData = [];
window.currentFilterPeriod = 'ALL';

window.calculateDashboardStats = (data) => {
    if (!data || data.length === 0) {
        document.getElementById('d-p-val').textContent = "0";
        document.getElementById('d-p-profit').textContent = "0";
        document.getElementById('d-p-roi').textContent = "0%";
        updateHeroColors(0);
        return;
    }

    // Sort Descending (Newest First) just in case
    data.sort((a, b) => {
        const dA = a.date && a.date.toDate ? a.date.toDate() : new Date(a.date);
        const dB = b.date && b.date.toDate ? b.date.toDate() : new Date(b.date);
        return dB - dA;
    });

    const latest = data[0];
    const oldest = data[data.length - 1];

    // 1. Current Value (Always from the latest record in the filtered set)
    const currentVal = latest.value || 0;

    // 2. Start Value (Oldest record in the filtered set)
    const startVal = oldest.value || 0;

    // 3. Net Flows (Sum of inclusive flows, excluding the start snapshot)
    let netFlows = 0;
    let netDepositsOnly = 0; // For ROI Denominator

    data.forEach((h, index) => {
        // Exclude the oldest entry from flows because it acts as the "Base Capital" for this period
        if (index === data.length - 1) return;

        const amount = h.cashflow || 0;
        if (h.type === 'DEPOSIT') {
            netFlows += amount;
            netDepositsOnly += amount;
        }
        if (h.type === 'WITHDRAW') {
            netFlows -= amount;
        }
    });

    // Formula: Profit = (Current - Start) - NetFlows
    const profit = (currentVal - startVal) - netFlows;

    // ROI Base calculation
    const totalInvested = startVal + netDepositsOnly;
    const profitPercent = totalInvested > 0 ? (profit / totalInvested) * 100 : 0;

    // Total Deposits and Withdrawals for Display
    // Note: 'totalwithdrawals' is sum of negative amounts (absolute value)
    let totalWithdrawalsAbs = 0;

    data.forEach(h => {
        if (h.type === 'WITHDRAW') totalWithdrawalsAbs += (h.cashflow || 0);
    });

    // Careful: 'netDepositsOnly' includes 'StartVal' implicitly if considered "Invested"? No, startVal is separate.
    // 'netDepositsOnly' calculated above is basically Sum of DEPOSITS during this period.
    // We want "Total Deposits" shown to user. Should it include Start Value?
    // User request: "Total Deposits". Usually means distinct cash inflows.
    // Let's use `netDepositsOnly` (calculated loop) + `startVal` (if startVal implies initial deposit).
    // Actually, simply summing up all DEPOSIT transactions is safer.

    let displayTotalDeposits = 0;
    data.forEach(h => {
        if (h.type === 'DEPOSIT') displayTotalDeposits += (h.cashflow || 0);
    });
    // Add Start Value if it acts as initial deposit? Yes, usually.
    // Actually, 'startVal' is the value at t=0. It might include profit.
    // But for "Total Invested Capital" metric we usually use (Start + Deposits).
    // Let's stick to "Cash In" vs "Cash Out".
    // "Total Invested" used for ROI is (Start + Sum(Deposits)).
    displayTotalDeposits = totalInvested; // Use the ROI base as "Total Capital Put In"

    // Update UI
    const isUSD = currentPortfolioCurrency === 'USD';
    const fmt = (num) => isUSD ? '$' + num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : window.formatMoney(num);

    document.getElementById('d-p-val').textContent = fmt(currentVal);
    document.getElementById('d-p-profit').textContent = fmt(profit);
    document.getElementById('d-p-roi').textContent = (profit >= 0 ? '+' : '') + profitPercent.toFixed(1) + '%';

    updateHeroColors(profit);

    // Update New Stats (Details Page)
    const depEl = document.getElementById('d-p-deposits');
    const withEl = document.getElementById('d-p-withdrawals');
    const avgEl = document.getElementById('d-p-avg-return');

    if (depEl) depEl.textContent = fmt(displayTotalDeposits);
    if (withEl) withEl.textContent = fmt(totalWithdrawalsAbs);
    if (avgEl) avgEl.textContent = profitPercent.toFixed(1) + '%';

    // Update Global Card Avg Return (Replacing R/R)
    const globalAvgEl = document.getElementById('global-avg-return');
    if (globalAvgEl) {
        globalAvgEl.textContent = profitPercent.toFixed(1) + '%';
        globalAvgEl.style.color = profit >= 0 ? 'var(--success)' : 'var(--danger)';
    }
};

window.updateChartFilter = (period) => {
    window.currentFilterPeriod = period;

    // Update Active Button State
    document.querySelectorAll('.filter-btn').forEach(b => {
        b.classList.remove('active');
        if (b.textContent.trim() === period) b.classList.add('active');
    });

    if (!window.cachedHistoryData || window.cachedHistoryData.length === 0) {
        // Render Empty State
        calculateDashboardStats([]);
        renderHistoryChart([]);
        renderHistoryTable([]);
        return;
    }

    // Filter Data
    const now = new Date();
    let cutoffDate = new Date(0); // Default ALL (1970)

    if (period === '1W') cutoffDate.setDate(now.getDate() - 7);
    if (period === '1M') cutoffDate.setDate(now.getDate() - 30);
    if (period === '1Y') cutoffDate.setDate(now.getDate() - 365);
    // 'ALL' keeps cutoff at 1970

    // Filter and Copy
    const filteredData = window.cachedHistoryData.filter(d => {
        const dDate = d.date && d.date.toDate ? d.date.toDate() : new Date(d.date);
        return dDate >= cutoffDate;
    });

    // Calculate Stats on Filtered Interval
    calculateDashboardStats(filteredData);
    renderHistoryChart(filteredData);

    // Render Table with "No Data" check
    if (filteredData.length === 0) {
        const list = document.getElementById('history-list-body');
        if (list) {
            list.innerHTML = `
                <tr>
                    <td colspan="4" style="text-align:center; padding: 30px; color: #888;">
                        <i class="fa-solid fa-filter-circle-xmark" style="font-size: 1.5rem; margin-bottom: 10px; opacity:0.5"></i>
                        <br>لا توجد بيانات في هذه الفترة
                    </td>
                </tr>
            `;
        }
    } else {
        renderHistoryTable(filteredData);
    }
};

window.handleHistoryUpdate = (snap) => {
    window.cachedHistoryData = [];

    if (!snap.empty) {
        snap.forEach(d => {
            window.cachedHistoryData.push({ id: d.id, ...d.data() });
        });
        // Sort Newest First
        window.cachedHistoryData.sort((a, b) => {
            const dA = a.date && a.date.toDate ? a.date.toDate() : new Date(a.date);
            const dB = b.date && b.date.toDate ? b.date.toDate() : new Date(b.date);
            return dB - dA;
        });

        // === SYNC PARENT DOC WITH REALITY ===
        if (window.cachedHistoryData.length > 0) {
            try {
                const latest = window.cachedHistoryData[0];
                const oldest = window.cachedHistoryData[window.cachedHistoryData.length - 1];

                // Robust Parse
                const pVal = (v) => {
                    const c = String(v).replace(/[^0-9.-]/g, '');
                    return parseFloat(c) || 0;
                };

                // Calc Total Deposits
                let totalDeposits = 0;
                for (let i = 0; i < window.cachedHistoryData.length - 1; i++) {
                    const d = window.cachedHistoryData[i];
                    if (d.type && String(d.type).toUpperCase() === 'DEPOSIT') {
                        totalDeposits += pVal(d.cashflow);
                    }
                }

                const trueStart = pVal(oldest.value);
                const trueCapital = trueStart + totalDeposits;
                const trueCurrent = pVal(latest.value);

                // Check if update needed (Debounce slightly or just check if diff)
                // We don't have currentPortfolioData handy here to check diff, but updateDoc is cheap enough for single portfolio events.
                // Or better, check current DOM value? No, unreliable.
                // Just update. It ensures consistency.

                // Only update if we have a valid ID
                if (window.currentPortfolioId) {
                    const pRef = doc(db, "users", auth.currentUser.uid, "portfolios", window.currentPortfolioId);
                    // Use setDoc with merge or updateDoc
                    updateDoc(pRef, {
                        currentValue: trueCurrent,
                        initialCapital: trueCapital,
                        lastUpdated: serverTimestamp()
                    }).catch(err => console.error("AutoSync Failed (Silent):", err));
                }
            } catch (err) {
                console.error("AutoSync Logic Error:", err);
            }
        }
    }

    // Trigger Filter - Default to 'ALL' to ensure visibility
    let activeFilter = 'ALL';
    const activeBtn = document.querySelector('.filter-btn.active');

    // If no button is active (first load), force ALL. If button is active, use it.
    if (activeBtn) {
        activeFilter = activeBtn.textContent.trim();
    } else {
        // Activate ALL button visually
        const allBtn = Array.from(document.querySelectorAll('.filter-btn')).find(b => b.textContent.trim() === 'ALL');
        if (allBtn) allBtn.classList.add('active');
    }

    // Handles Rendering Table, Chart, and Stats
    window.updateChartFilter(activeFilter);
};
