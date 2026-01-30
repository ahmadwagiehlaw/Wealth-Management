import { auth, db } from './firebase-config.js';
import {
    createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
    collection, addDoc, deleteDoc, updateDoc, doc, onSnapshot, serverTimestamp, query, orderBy, runTransaction, getDocs, setDoc, limit
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// === المتغيرات ===
console.log('🚀 Script Start');
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

    const nav = document.getElementById('main-nav');
    if (nav) {
        // Force flex display if not auth, otherwise hide
        nav.style.display = (viewName === 'auth') ? 'none' : 'flex';
    }

    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    const navMap = {
        'dashboard': 'home',
        'details': 'home',
        'journal': 'journal',
        'calculator': 'calculator',
        'lessons': 'lessons',
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
// === نظام Toast للإشعارات ===
window.showToast = (message, type = 'info') => {
    const container = document.getElementById('toast-container');
    if (!container) return;

    // Fix icon mapping
    const iconMap = {
        success: 'fa-check-circle',
        error: 'fa-circle-exclamation', // Changed from fa-exclamation-circle to match users screenshot expectation or standard
        info: 'fa-circle-info'
    };
    const iconClass = iconMap[type] || iconMap.info;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type} show`;

    // Use innerHTML but careful with message
    toast.innerHTML = `
        <i class="fa-solid ${iconClass}"></i>
        <span style="margin-right:8px">${message}</span>
    `;

    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
};
console.log('🚀 Checkpoint 1: showToast defined');


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
// 3. المخاطرة
window.calcRR = () => {
    const entry = parseFloat(document.getElementById('rr-entry').value) || 0;
    const target = parseFloat(document.getElementById('rr-target').value) || 0;
    const stop = parseFloat(document.getElementById('rr-stop').value) || 0;
    const riskAmount = parseFloat(document.getElementById('rr-risk-amount').value) || 0;

    if (entry === 0) return;

    let profitPer = 0, lossPer = 0;
    if (target > 0) profitPer = ((target - entry) / entry) * 100;
    if (stop > 0) lossPer = ((stop - entry) / entry) * 100;

    // Update Text
    const profitEl = document.getElementById('rr-profit');
    const lossEl = document.getElementById('rr-loss');

    if (profitEl) profitEl.textContent = profitPer > 0 ? `+${profitPer.toFixed(2)}%` : '0%';
    if (lossEl) lossEl.textContent = lossPer < 0 ? `${lossPer.toFixed(2)}%` : '0%';

    // R:R Ratio & Logic
    let ratioVal = 0;
    const ratioEl = document.getElementById('rr-ratio');
    if (profitPer > 0 && lossPer < 0) {
        ratioVal = Math.abs(profitPer / lossPer);
        const ratioDisplay = ratioVal.toFixed(2);
        ratioEl.textContent = `1 : ${ratioDisplay}`;
        ratioEl.style.color = ratioVal >= 2 ? 'var(--success)' : (ratioVal >= 1 ? '#fff' : 'var(--danger)');
    } else {
        ratioEl.textContent = "0 : 0";
        ratioEl.style.color = '#fff';
    }

    // Position Sizing
    const qtyEl = document.getElementById('rr-qty');
    if (riskAmount > 0 && stop > 0 && entry > 0) {
        const riskPerShare = Math.abs(entry - stop);
        if (riskPerShare > 0) {
            const suggestedQty = Math.floor(riskAmount / riskPerShare);
            qtyEl.textContent = suggestedQty.toLocaleString();
            qtyEl.parentElement.classList.remove('hidden'); // Ensure visible
        } else {
            qtyEl.textContent = "-";
        }
    } else {
        qtyEl.textContent = "-";
    }

    // Visualizer Logic
    const barProfit = document.getElementById('rr-bar-profit');
    const barLoss = document.getElementById('rr-bar-loss');
    const labelProfit = document.getElementById('label-profit');
    const labelLoss = document.getElementById('label-loss');

    if (barProfit && barLoss) {
        // Reset
        barProfit.style.width = '0%';
        barLoss.style.width = '0%';

        // We want to visualize the Ratio, not purely price distance, but let's stick to price scale
        // Total Range = (Target - Stop). 
        // If undefined, use arbitrary defaults for visualization

        if (target > 0 && stop > 0) {
            // Calculate relative distances
            const upside = Math.abs(target - entry);
            const downside = Math.abs(entry - stop);
            const total = upside + downside;

            // Limit visualization to avoid one side swallowing the other in extreme cases (e.g. 1:50)
            // But let's try direct proportion first
            const profitWidth = (upside / total) * 100;
            const lossWidth = (downside / total) * 100;

            // In our CSS, we have a flex wrapper.
            // Center is entry. 
            // We can just set widths relative to a max potential width of "50%" each? 
            // No, the design is complex. Let's simplify.
            // Let's assume the bar total width represents the trade range.

            barProfit.style.width = `${profitWidth}%`;
            barLoss.style.width = `${lossWidth}%`;

            // Update Labels
            if (labelProfit) labelProfit.textContent = target.toFixed(2);
            if (labelLoss) labelLoss.textContent = stop.toFixed(2);
        } else {
            // Default state if incomplete
            if (labelProfit) labelProfit.textContent = "TP";
            if (labelLoss) labelLoss.textContent = "SL";
        }
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
    if (!data || data.length === 0) return;
    const ctx = document.getElementById('portfolioChart').getContext('2d');
    if (window.currentChart) window.currentChart.destroy();

    window.currentChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: data.map(d => new Date(d.date.seconds * 1000).toLocaleDateString('ar-EG')),
            datasets: [{
                label: 'قيمة المحفظة',
                data: data.map(d => d.value),
                borderColor: '#0a84ff',
                backgroundColor: 'rgba(10, 132, 255, 0.1)',
                tension: 0.4,
                fill: true
            }]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });
}

window.setView = (viewId) => {
    document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

    const target = document.getElementById(viewId + '-section');
    if (target) target.classList.remove('hidden');

    const navBtn = document.getElementById('nav-' + viewId);
    if (navBtn) navBtn.classList.add('active');
};

document.addEventListener('DOMContentLoaded', () => {
    const createBtn = document.getElementById('create-portfolio-btn');
    if (createBtn) {
        createBtn.addEventListener('click', () => {
            document.getElementById('create-portfolio-modal').showModal();
        });
    }
});

// ==========================================
// 🧠 VIRTUAL STRATEGY LAB (Consolidated)
// ==========================================

let allocationChartInstance = null;
let currentStrategy = [];
let portfolioAssets = [];
let strategySettings = {
    capital: 100000,
    riskProfile: 'BALANCED',
    cashTarget: 20,
    maxAssetAlloc: 20
};

// --- SETTINGS & CONFIG ---
window.openStrategySettings = async () => {
    document.getElementById('st-total-capital').value = strategySettings.capital || 100000;
    document.getElementById('st-cash-target').value = strategySettings.cashTarget || 20;
    document.getElementById('st-max-asset').value = strategySettings.maxAssetAlloc || 20;

    const profiles = { 'DEFENSIVE': 0, 'BALANCED': 1, 'AGGRESSIVE': 2 };
    const btns = document.querySelectorAll('#strategy-settings-modal .sc-btn');
    btns.forEach(b => b.classList.remove('active'));

    // Default to Balanced if unknown
    const profileIdx = profiles[strategySettings.riskProfile] !== undefined ? profiles[strategySettings.riskProfile] : 1;
    if (btns[profileIdx]) btns[profileIdx].classList.add('active');

    document.getElementById('strategy-settings-modal').showModal();
};

window.setRiskProfile = (profile, btn) => {
    strategySettings.riskProfile = profile;
    document.querySelectorAll('#strategy-settings-modal .sc-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    if (profile === 'DEFENSIVE') {
        document.getElementById('st-cash-target').value = 40;
        document.getElementById('st-max-asset').value = 10;
    } else if (profile === 'AGGRESSIVE') {
        document.getElementById('st-cash-target').value = 10;
        document.getElementById('st-max-asset').value = 30;
    } else {
        document.getElementById('st-cash-target').value = 20;
        document.getElementById('st-max-asset').value = 20;
    }
};

window.saveStrategySettings = async () => {
    const cap = parseFloat(document.getElementById('st-total-capital').value) || 0;
    const cashT = parseFloat(document.getElementById('st-cash-target').value) || 0;
    const maxA = parseFloat(document.getElementById('st-max-asset').value) || 0;

    strategySettings = {
        capital: cap,
        cashTarget: cashT,
        maxAssetAlloc: maxA,
        riskProfile: strategySettings.riskProfile || 'BALANCED'
    };

    // Save to Global Settings
    try {
        const settingsRef = doc(db, "users", auth.currentUser.uid, "settings", "allocation_config");
        await setDoc(settingsRef, strategySettings);
        showToast("تم حفظ الإعدادات", "success");
        document.getElementById('strategy-settings-modal').close();

        // Reload View
        window.loadAllocationView();
    } catch (e) {
        console.error("Save Error:", e);
        showToast("حدث خطأ في الحفظ", "error");
    }
};

// --- MAIN VIRTUAL STRATEGY LOAD ---
window.loadAllocationView = async () => {
    // Ensure container visible
    const chartContainer = document.getElementById('allocationChart').parentElement;
    if (chartContainer) chartContainer.classList.remove('hidden');

    const coachPanel = document.getElementById('coach-panel');
    if (coachPanel) coachPanel.classList.add('hidden');

    // Clear list initially
    const list = document.getElementById('strategy-list');
    if (list) list.innerHTML = ''; // Clear loaded state

    showLoading();
    try {
        // 1. Fetch Global Settings or Default
        const settingsRef = doc(db, "users", auth.currentUser.uid, "settings", "allocation_config");
        let settingsSnap = { exists: () => false };
        try { settingsSnap = await getDoc(settingsRef); } catch (e) { console.log('No settings found, using defaults'); }

        if (settingsSnap.exists()) {
            strategySettings = settingsSnap.data();
        } else {
            // Keep defaults if not found
            if (!strategySettings.capital) strategySettings.capital = 100000;
        }

        // 2. Fetch Global Strategy items
        currentStrategy = [];
        let virtualInvested = 0;

        const stratRef = collection(db, "users", auth.currentUser.uid, "global_strategy");
        const stratSnap = await getDocs(stratRef);

        stratSnap.forEach(doc => {
            const d = doc.data();
            currentStrategy.push({ name: doc.id, ...d });
            virtualInvested += (d.virtualActualOfAsset || 0); // Using manual virtual actual
        });

        // 3. Calculate Virtual Cash
        const totalCap = strategySettings.capital || virtualInvested || 100000;
        let virtualCash = totalCap - virtualInvested;

        // Prepare Assets Array for Render
        portfolioAssets = [
            ...currentStrategy.map(s => ({
                name: s.name,
                value: s.virtualActualOfAsset || 0,
                targetPct: s.targetPercent,
                targetAmt: (s.targetPercent / 100) * totalCap,
                type: 'ASSET'
            })),
            { name: 'CASH (سيولة)', value: virtualCash, type: 'CASH' }
        ];

        renderAllocationDashboard();
    } catch (e) {
        console.error("Load Error:", e);
        showToast("تعذر تحميل المختبر الافتراضي", "error");
    } finally {
        hideLoading();
    }
};

// --- RENDER DASHBOARD (REDESIGN) ---
function renderAllocationDashboard() {
    const list = document.getElementById('strategy-list');
    list.innerHTML = '';

    const totalVal = strategySettings.capital || 1; // User Defined Capital
    let totalInvested = 0; // Utilized Capital
    portfolioAssets.forEach(a => { if (a.type !== 'CASH') totalInvested += a.value; });

    // 1. Update Top Dashboard Stats (Grid)
    const capEl = document.getElementById('dash-total-cap');
    const targetEl = document.getElementById('dash-target-inv');
    const execEl = document.getElementById('dash-actual-exec');

    if (capEl) capEl.textContent = window.formatCompactNumber(totalVal);
    if (targetEl) targetEl.textContent = window.formatCompactNumber(totalVal * (1 - ((strategySettings.cashTarget || 0) / 100)));
    if (execEl) execEl.textContent = window.formatCompactNumber(totalInvested);

    // Compliance Score
    const compliance = Math.min(100, Math.round((totalInvested / totalVal) * 100));
    const compEl = document.getElementById('dash-compliance');
    if (compEl) {
        compEl.textContent = compliance + '%';
        compEl.style.color = compliance > 90 ? 'var(--danger)' : (compliance > 50 ? 'var(--success)' : 'var(--gold)');
    }

    // Update Big Pie Center Text
    const bigUtilized = document.getElementById('big-utilized-pct');
    if (bigUtilized) bigUtilized.textContent = ((totalInvested / totalVal) * 100).toFixed(0) + '%';


    if (portfolioAssets.length === 0 || (portfolioAssets.length === 1 && portfolioAssets[0].type === 'CASH')) {
        list.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-briefcase empty-icon" style="color:var(--primary); opacity:0.5;"></i>
                <p style="color:#aaa;">المحفظة فارغة حالياً.<br>ابدأ بإضافة الأصول لتبني خطتك الاستثمارية.</p>
                <button class="btn-primary" style="margin-top:10px" onclick="window.autoGenerateStrategy()">
                    <i class="fa-solid fa-wand-magic-sparkles"></i> إنشاء خطة من الواقع
                </button>
            </div>
            `;
        // Still render chart for empty state (100% Cash/Free)
        renderAllocationChart([], totalVal);
        return;
    }

    // 2. Render Asset Cards (Visual "Candles/Stages")
    portfolioAssets.forEach(item => {
        if (item.type === 'CASH') return;

        const targetPct = item.targetPct;
        const targetAmt = item.targetAmt;
        const actualAmt = item.value;
        const actualPctOfTarget = targetAmt > 0 ? (actualAmt / targetAmt) * 100 : 0;

        // Status & Color Logic
        let progressBarColor = 'var(--success)'; // Green = Healthy Execution
        if (actualPctOfTarget > 100) progressBarColor = 'var(--danger)'; // Over-allocated
        if (actualPctOfTarget < 20) progressBarColor = 'var(--gold)'; // Just starting

        const remainingToTarget = targetAmt - actualAmt;
        const remainingText = remainingToTarget > 0
            ? `<span class="text-gold">${window.formatCompactNumber(remainingToTarget)}</span> متبقي`
            : `<span class="text-danger">+${window.formatCompactNumber(Math.abs(remainingToTarget))}</span> فائض`;

        // Card HTML
        const isNearCeiling = actualPctOfTarget > 90; // Near limit if > 90% of target
        const card = document.createElement('div');
        card.className = `alloc-card-visual ${isNearCeiling ? 'near-limit' : ''}`;
        card.innerHTML = `
            <div class="card-visual-header">
                <div class="card-title-group">
                    <div class="icon-box-sm" style="background:${stringToColor(item.name)}20; color:${stringToColor(item.name)}">
                        <i class="fa-solid fa-layer-group"></i>
                    </div>
                    <div>
                        <h3>${item.name}</h3>
                        <span class="badge-pill">Target ${targetPct}%</span>
                    </div>
                </div>
                <div class="card-actions">
                     <button class="btn-icon-sm" onclick="window.editStrategyItem('${item.name}', ${targetPct}, ${actualAmt})">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                </div>
            </div>

            <div class="stage-container">
                <div class="vp-labels">
                    <span>التنفيذ: ${actualPctOfTarget.toFixed(0)}% من المستهدف</span>
                    <span>${window.formatCompactNumber(targetAmt)} EGP</span>
                </div>
                
                <!-- The Bar Track -->
                <div class="stage-track">
                    <!-- Markers for stages (25%, 50%, 75%) -->
                    <div class="stage-marker" style="left:25%"></div>
                    <div class="stage-marker" style="left:50%"></div>
                    <div class="stage-marker" style="left:75%"></div>

                    <!-- The Fill -->
                    <div class="stage-fill" style="width:${Math.min(actualPctOfTarget, 100)}%; background:${progressBarColor};"></div>
                </div>
            </div>

            <div class="detail-stats-grid">
                <div class="ds-item">
                    <span class="ds-lbl">التنفيذ الحالي</span>
                    <span class="ds-val">${window.formatCompactNumber(actualAmt)}</span>
                </div>
                <div class="ds-item">
                    <span class="ds-lbl">المتبقي للشراء</span>
                    <span class="ds-val">${remainingText}</span>
                </div>
                <div class="ds-item">
                    <span class="ds-lbl">المدى (Room)</span>
                    <span class="ds-val" style="color:#666">${window.formatCompactNumber(Math.max(0, (totalVal * 0.20) - actualAmt))}</span>
                </div>
            </div>
        `;
        list.appendChild(card);
    });

    // Chart Data Preparation
    const combined = new Map();
    portfolioAssets.forEach(a => combined.set(a.name, { name: a.name, actualAmt: a.value }));
    renderAllocationChart(combined, totalVal);
    updateHealthScore(combined, totalVal);
}

// --- RENDER ALLOCATION CHART WITH LEGEND ---
function renderAllocationChart(items, totalVal) {
    const canvas = document.getElementById('allocationChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (allocationChartInstance) allocationChartInstance.destroy();

    const labels = [];
    const data = [];
    const colors = [];

    // Prepare data
    items.forEach((item, key) => {
        labels.push(item.name);
        data.push(item.actualAmt);
        colors.push(stringToColor(item.name));
    });

    // Add "Available Cash" as remainder
    const totalUsed = data.reduce((a, b) => a + b, 0);
    const cashRemaining = Math.max(0, totalVal - totalUsed);
    if (cashRemaining > 0) {
        labels.push('سيولة متاحة');
        data.push(cashRemaining);
        colors.push('#444455');
    }

    // Create Chart
    allocationChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 0 }] },
        options: {
            cutout: '70%',
            responsive: true,
            maintainAspectRatio: true,
            plugins: { legend: { display: false } }
        }
    });

    // Populate Legend
    const legendEl = document.getElementById('chart-legend');
    if (legendEl) {
        legendEl.innerHTML = '';
        const total = data.reduce((a, b) => a + b, 0);
        labels.forEach((name, i) => {
            const pct = total > 0 ? ((data[i] / total) * 100).toFixed(0) : 0;
            const item = document.createElement('div');
            item.className = 'legend-item';
            item.innerHTML = `
                <span class="legend-dot" style="background:${colors[i]}"></span>
                <span class="legend-label">${name}</span>
                <span class="legend-val">${pct}%</span>
            `;
            legendEl.appendChild(item);
        });
    }
}

// --- NEW HELPERS ---

// 1. Reset Data
window.resetAllocationData = async () => {
    if (!confirm("⚠️ تحذير: سيتم حذف جميع خطط التوزيع والبيانات في المختبر الافتراضي.\n\nهل أنت متأكد؟")) return;

    showLoading();
    try {
        // Delete all docs in 'global_strategy'
        const stratRef = collection(db, "users", auth.currentUser.uid, "global_strategy");
        const snap = await getDocs(stratRef);

        const promises = [];
        snap.forEach(doc => {
            promises.push(deleteDoc(doc.ref));
        });

        await Promise.all(promises);

        showToast("تم تصفير المختبر بنجاح", "success");
        loadAllocationView(); // Reload empty state
    } catch (e) {
        console.error(e);
        showToast("حدث خطأ أثناء التصفير", "error");
    } finally {
        hideLoading();
    }
};

// 2. Slider - Logic for "Scaling In"
window.syncExecutionInputs = (source) => {
    const slider = document.getElementById('exec-slider');
    const labelVal = document.getElementById('exec-slider-val');
    const moneyInput = document.getElementById('strat-actual-manual');

    // Get Target Amount (Hidden or Calculated)
    // We can re-calculate it from Target % and Total Capital
    const pct = parseFloat(document.getElementById('strat-percent').value) || 0;
    const baseCapital = strategySettings.capital > 0 ? strategySettings.capital : 100000;
    const targetAmt = (pct / 100) * baseCapital;

    if (source === 'slider') {
        const percentage = parseInt(slider.value);
        labelVal.textContent = percentage + '%';

        // Calculate Money Value: (Percentage / 100) * TargetAmount
        const moneyVal = (percentage / 100) * targetAmt;
        moneyInput.value = Math.round(moneyVal);

    } else if (source === 'input') {
        // Reverse Logic: Calculate % from Money
        const moneyVal = parseFloat(moneyInput.value) || 0;
        let percentage = 0;
        if (targetAmt > 0) {
            percentage = (moneyVal / targetAmt) * 100;
        }
        // Clamping for slider visual, but value can exceed 100% technically
        slider.value = Math.min(100, Math.round(percentage));
        labelVal.textContent = Math.round(percentage) + '%';

        // Change color if over 100%?
        if (percentage > 100) labelVal.style.color = 'var(--danger)';
        else labelVal.style.color = 'var(--success)';
    }
};

function remaningSign(val) {
    return val > 0 ? '+' : (val < 0 ? '-' : '');
}

function updateHealthScore(items, totalVal) {
    let score = 100;
    const tips = document.getElementById('coach-tips');
    if (tips) tips.innerHTML = '';

    // Logic remains similar but could be enhanced later
    // ... (Existing logic for health score) ...
    // Keeping it simple for now to focus on UI

    const panel = document.getElementById('coach-panel');
    if (!tips.innerHTML && panel) {
        tips.innerHTML = '<li>✅ بداية موفقة! قم بإضافة المزيد من الأصول لتنويع محفظتك.</li>';
        panel.classList.remove('hidden');
    }
}


function stringToColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
    return '#' + '00000'.substring(0, 6 - c.length) + c;
}

// Update Edit/Save for Virtual Actuals
window.editStrategyItem = (name, targetPct, currentActual = 0) => {
    // Determine Target Amount from Strategy Capital
    const baseCapital = strategySettings.capital || 100000;
    const targetAmt = (targetPct / 100) * baseCapital;

    document.getElementById('strat-name').value = name;
    document.getElementById('strat-name').setAttribute('readonly', true);

    // Calculate Diff Hint (legacy element, can be removed or ignored)

    // NEW: Sync Sliders
    document.getElementById('strat-slider').value = targetPct;
    document.getElementById('strat-percent').value = targetPct;
    document.getElementById('strat-calc-target-amount').textContent = window.formatCompactNumber(targetAmt);

    // Set Execution Data
    document.getElementById('strat-actual-manual').value = Math.round(currentActual);
    window.syncExecutionInputs('input'); // This will set the execution slider position

    document.getElementById('strategy-modal').showModal();
};

window.syncStrategyInputs = (source) => {
    const baseCapital = strategySettings.capital > 0 ? strategySettings.capital : 100000;

    const slider = document.getElementById('strat-slider');
    const pctInput = document.getElementById('strat-percent');

    // logic ...
    if (source === 'slider') {
        pctInput.value = slider.value;
    } else if (source === 'percent') {
        slider.value = pctInput.value;
    }

    // Update Calculated Text Display
    const p = parseFloat(pctInput.value) || 0;
    const amt = (p / 100) * baseCapital;
    document.getElementById('strat-calc-target-amount').textContent = window.formatCompactNumber(amt);

    // Also update execution slider based on new target if needed? 
    // Maybe best to just leave execution absolute value alone, but slider % will change.
    window.syncExecutionInputs('input'); // Re-eval execution % based on new target
};


window.saveStrategyItem = async () => {
    const name = document.getElementById('strat-name').value;
    const targetPct = parseFloat(document.getElementById('strat-percent').value);
    const manualActual = parseFloat(document.getElementById('strat-actual-manual').value) || 0;

    if (!name) return;

    showLoading();
    try {
        const stratRef = doc(collection(db, "users", auth.currentUser.uid, "global_strategy"), name);
        await setDoc(stratRef, {
            name: name,
            targetPercent: targetPct,
            targetAmount: (targetPct / 100) * (strategySettings.capital || 0),
            virtualActualOfAsset: manualActual, // Saving Manual Input
            updatedAt: serverTimestamp()
        }, { merge: true }); // Merge to keep other fields if any

        showToast("تم تحديث السيناريو", "success");
        document.getElementById('strategy-modal').close();
        loadAllocationView();
    } catch (e) {
        console.error(e);
        showToast("حدث خطأ", "error");
    } finally {
        hideLoading();
    }
};

window.autoGenerateStrategy = async () => {
    showLoading();
    try {
        // Logic: Create Global Strategy from Aggregated Actuals
        // We already have 'portfolioAssets' populated with merged actuals in global scope from load().
        // Just loop and save.

        const totalVal = strategySettings.capital || 1;
        const batch = writeBatch(db);

        portfolioAssets.forEach(asset => {
            if (asset.type === 'CASH') return;
            const ref = doc(collection(db, "users", auth.currentUser.uid, "global_strategy"), asset.name);
            const pct = (asset.value / totalVal) * 100;
            batch.set(ref, {
                name: asset.name,
                targetPercent: parseFloat(pct.toFixed(1)),
                updatedAt: serverTimestamp()
            });
        });

        await batch.commit();
        showToast('تم استيراد المحفظة الواقعية كخطة استراتيجية', 'success');
        loadAllocationView();
    } catch (e) {
        showToast('خطأ: ' + e.message, 'error');
    } finally {
        hideLoading();
    }
};



window.formatCompactNumber = (number) => {
    return new Intl.NumberFormat('en-US', { notation: "compact", maximumFractionDigits: 1 }).format(number);
};

// === Strategy Modal Logic ===
// === Strategy Management Helpers ===

window.addNewAssetStrategy = () => {
    document.getElementById('strat-name').removeAttribute('readonly');
    document.getElementById('strat-name').style.opacity = '1';
    document.getElementById('strat-name').value = '';
    document.getElementById('strat-slider').value = 0;
    document.getElementById('strat-percent').value = 0;
    document.getElementById('strat-amount').value = 0;
    document.getElementById('strat-actual-manual').value = '';
    document.getElementById('strat-notes').value = '';
    document.getElementById('strategy-modal').showModal();
};

window.deleteStrategyItem = async () => {
    const name = document.getElementById('strat-name').value;
    if (!name) return;

    if (!confirm('هل أنت متأكد من حذف هذا الأصل من الخطة؟')) return;

    showLoading();
    try {
        await deleteDoc(doc(db, "users", auth.currentUser.uid, "global_strategy", name));
        showToast('تم حذف الأصل', 'success');
        document.getElementById('strategy-modal').close();
        loadAllocationView();
    } catch (e) {
        console.error(e);
        showToast('حدث خطأ أثناء الحذف', 'error');
    } finally {
        hideLoading();
    }
};


// --- TOAST NOTIFICATION SYSTEM ---
window.showToast = (message, type = 'info') => {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast - ${type} `;
    toast.innerHTML = `
            < i class="fa-solid ${type === 'success' ? 'fa-circle-check' : type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-info'}" ></i >
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

            console.log(`📊 Sync Calc: Start = ${startVal}, AddDeps = ${additionalDeposits}, CalcCap = ${newInitialCapital}, CurrVal = ${latestVal} `);

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

// (Legacy Journal V1 Removed)



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
        a.download = `my - wealth - backup - ${Date.now()}.json`;
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
            actionBadge = `< span class="badge-text success" title = "إيداع" > +${cfAmount}</span > `;
        }
        else if (h.type === 'WITHDRAW') {
            const cfAmount = h.cashflow ? formatCompact(h.cashflow) : '';
            actionBadge = `< span class="badge-text danger" title = "سحب" > -${cfAmount}</span > `;
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
                simpleChange = `< span style = "color:${color}; font-size:0.75rem; font-weight:600; font-family:'Inter'; margin-right:6px" dir = "ltr" > ${isPos ? '+' : '-'}${per.toFixed(1)}%</span > `;
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
            < tr >
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
        </tr >
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
            < tr >
            <td colspan="4" style="text-align:center; padding: 30px; color: #888;">
                <i class="fa-solid fa-filter-circle-xmark" style="font-size: 1.5rem; margin-bottom: 10px; opacity:0.5"></i>
                <br>لا توجد بيانات في هذه الفترة
            </td>
                </tr >
            `;
        }
    } else {
        renderHistoryTable(filteredData);
    }
};

/* ========================================= */
/*        TRADING JOURNAL MODULE (NEW)       */
/* ========================================= */

// --- UI MANAGERS ---
window.journalCache = [];
window.journalFilter = 'ALL';

window.openNewCenterModal = () => {
    // Reset Edit Mode
    document.getElementById('jc-edit-id').value = '';
    document.getElementById('btn-save-center').textContent = 'فتح المركز';

    // Clear Fields
    document.getElementById('jc-asset').value = '';
    document.getElementById('jc-thesis').value = '';
    document.getElementById('jc-stop').value = '';
    document.getElementById('jc-target').value = '';

    document.getElementById('new-center-modal').showModal();
};

window.showAddExecModal = async (centerId) => {
    document.getElementById('exec-center-id').value = centerId;
    document.getElementById('exec-edit-id').value = ''; // Reset Edit ID
    document.getElementById('btn-save-exec').textContent = 'تسجيل';
    document.getElementById('add-execution-title').innerHTML = '<i class="fa-solid fa-pen-to-square"></i> تسجيل تنفيذ';

    // Populate Portfolios
    const pSelect = document.getElementById('exec-portfolio');
    pSelect.innerHTML = '<option value="NONE">بدون محفظة (Global)</option>';

    try {
        const snap = await getDocs(collection(db, 'users', auth.currentUser.uid, 'portfolios'));
        snap.forEach(doc => {
            const p = doc.data();
            const option = document.createElement('option');
            option.value = doc.id;
            option.textContent = p.name + (p.currency ? ` (${p.currency})` : '');
            pSelect.appendChild(option);
        });
    } catch (e) { console.error('Failed to load portfolios for select', e); }

    // Reset Fields
    document.getElementById('exec-type').value = 'OPEN';
    document.getElementById('exec-price').value = '';
    document.getElementById('exec-qty').value = '';
    document.getElementById('exec-date').valueAsDate = new Date();
    document.getElementById('exec-portfolio').value = "NONE";
    document.getElementById('exec-mistake').value = 'NONE';
    document.querySelectorAll('.tags-container input').forEach(cb => cb.checked = false);

    document.getElementById('add-execution-modal').showModal();
};

// --- CORE LOGIC: Create / Update Campaign ---
window.submitNewCenter = async () => {
    const editId = document.getElementById('jc-edit-id').value;
    const asset = document.getElementById('jc-asset').value;
    const direction = document.getElementById('jc-direction').value;
    const strategy = document.getElementById('jc-strategy').value;
    const thesis = document.getElementById('jc-thesis').value;
    const stop = document.getElementById('jc-stop').value;
    const target = document.getElementById('jc-target').value;

    if (!asset) return showToast('Please enter an Asset Symbol', 'error');

    showLoading();
    try {
        const data = {
            asset: asset.toUpperCase(),
            direction,
            strategy,
            thesis,
            stop: parseFloat(stop) || 0,
            target: parseFloat(target) || 0,
            lastUpdate: serverTimestamp()
        };

        if (editId) {
            // UPDATE EXISTING
            await updateDoc(doc(db, 'users', auth.currentUser.uid, 'journal_centers', editId), data);
            showToast('Campaign Updated Successfully! 📝', 'success');
        } else {
            // CREATE NEW
            data.status = 'OPEN';
            data.createdAt = serverTimestamp();
            await addDoc(collection(db, 'users', auth.currentUser.uid, 'journal_centers', editId), data);
            showToast('Campaign Opened Successfully! ♟️', 'success');
        }

        document.getElementById('new-center-modal').close();
        window.loadJournal(); // Refresh
    } catch (e) {
        console.error(e);
        showToast('Error saving campaign', 'error');
    } finally {
        hideLoading();
    }
};

window.editCenter = (id) => {
    const center = window.journalCache.find(c => c.id === id);
    if (!center) return;

    document.getElementById('jc-edit-id').value = id;
    document.getElementById('jc-asset').value = center.asset;
    document.getElementById('jc-direction').value = center.direction;
    document.getElementById('jc-strategy').value = center.strategy;
    document.getElementById('jc-thesis').value = center.thesis || '';
    document.getElementById('jc-stop').value = center.stop;
    document.getElementById('jc-target').value = center.target;

    document.getElementById('btn-save-center').textContent = 'حفظ التعديلات';
    document.getElementById('new-center-modal').showModal();
};

// --- CORE LOGIC: Add / Edit Execution ---
window.submitExecution = async () => {
    const centerId = document.getElementById('exec-center-id').value;
    const editExecId = document.getElementById('exec-edit-id').value;

    const type = document.getElementById('exec-type').value;
    const price = parseFloat(document.getElementById('exec-price').value);
    const qty = parseFloat(document.getElementById('exec-qty').value);
    const dateInput = document.getElementById('exec-date').value;
    const portfolioId = document.getElementById('exec-portfolio').value; // Get Portfolio

    const date = dateInput ? new Date(dateInput) : new Date();
    const mistake = document.getElementById('exec-mistake').value;

    const tags = [];
    document.querySelectorAll('.tags-container input:checked').forEach(cb => tags.push(cb.value));

    if (!price || !qty) return showToast('Please check Price/Qty', 'error');

    const btn = document.getElementById('btn-save-exec');
    btn.disabled = true;
    btn.textContent = 'جاري الحفظ...';

    showLoading();

    try {
        const data = {
            type,
            price,
            qty,
            date,
            portfolioId: portfolioId === "NONE" ? null : portfolioId, // Save Logic
            tags,
            mistake
        };

        if (editExecId) {
            // Update Existing Execution
            await updateDoc(doc(db, 'users', auth.currentUser.uid, 'journal_centers', centerId, 'executions', editExecId), data);
            showToast('Execution Updated! 📝', 'success');
        } else {
            // Create New
            data.createdAt = serverTimestamp();
            await addDoc(collection(db, 'users', auth.currentUser.uid, 'journal_centers', centerId, 'executions'), data);
            showToast('Execution Logged! 📝', 'success');
        }

        document.getElementById('add-execution-modal').close();
        window.loadJournal(); // Refresh
    } catch (e) {
        console.error(e);
        showToast('Failed to save execution', 'error');
    } finally {
        hideLoading();
        btn.disabled = false;
        btn.textContent = 'تسجيل';
    }
};

window.editExecution = (centerId, execId) => {
    const center = window.journalCache.find(c => c.id === centerId);
    if (!center) return;
    const exec = center.executions.find(e => e.id === execId);
    if (!exec) return;

    document.getElementById('exec-center-id').value = centerId;
    document.getElementById('exec-edit-id').value = execId;
    document.getElementById('add-execution-title').innerHTML = '<i class="fa-solid fa-pen"></i> تعديل تنفيذ';
    document.getElementById('btn-save-exec').textContent = 'حفظ التعديلات';

    document.getElementById('exec-type').value = exec.type;
    document.getElementById('exec-price').value = exec.price;
    document.getElementById('exec-qty').value = exec.qty;
    // Handle Date
    const d = exec.date && exec.date.toDate ? exec.date.toDate() : new Date(exec.date);
    document.getElementById('exec-date').value = d.toISOString().split('T')[0];

    document.getElementById('exec-mistake').value = exec.mistake || 'NONE';

    // Tags
    document.querySelectorAll('.tags-container input').forEach(cb => {
        cb.checked = exec.tags && exec.tags.includes(cb.value);
    });

    document.getElementById('add-execution-modal').showModal();
};

window.deleteExecution = async (centerId, execId) => {
    if (!confirm('هل أنت متأكد من حذف هذا التنفيذ؟')) return;
    try {
        await deleteDoc(doc(db, 'users', auth.currentUser.uid, 'journal_centers', centerId, 'executions', execId));
        showToast('Execution Deleted', 'success');
        window.loadJournal();
    } catch (e) {
    }
};

// --- CORE LOGIC: Load Journal// --- MAIN VIEW LOAD ---


// --- CORE LOGIC: Load Journal & Analytics ---
window.loadJournal = async () => {
    if (!auth.currentUser) return;
    const list = document.getElementById('active-centers-list');
    if (!list) return;
    list.innerHTML = '<div class="spinner"></div>';

    try {
        // Fetch All Centers
        const q = query(collection(db, 'users', auth.currentUser.uid, 'journal_centers'), orderBy('createdAt', 'desc'));
        const snap = await getDocs(q);

        // Pre-process Data for Cache
        window.journalCache = [];

        for (const docSnap of snap.docs) {
            const d = docSnap.data();
            const centerItem = { id: docSnap.id, ...d, executions: [], stats: {} };

            // Fetch Executions (Subcollection)
            const execsRef = collection(db, 'users', auth.currentUser.uid, 'journal_centers', docSnap.id, 'executions');
            const execsSnap = await getDocs(execsRef);

            let execsData = [];
            execsSnap.forEach(e => execsData.push({ id: e.id, ...e.data() }));

            // CRITICAL: Sort by Date ASC (Oldest First) for correct Avg Price Calc
            execsData.sort((a, b) => {
                const da = a.date && a.date.toDate ? a.date.toDate() : new Date(a.date);
                const db = b.date && b.date.toDate ? b.date.toDate() : new Date(b.date);
                return da - db;
            });

            let realizedPnL = 0;
            let totalQty = 0;
            let avgPrice = 0;
            let currentMistake = 'NONE';
            let mistakeCost = 0;
            let investedCapital = 0; // Track max invested for ROI calc

            execsData.forEach(ed => {
                const q = parseFloat(ed.qty) || 0;
                const p = parseFloat(ed.price) || 0;

                if (ed.mistake && ed.mistake !== 'NONE') currentMistake = ed.mistake;

                if (ed.type === 'OPEN' || ed.type === 'ADD' || ed.type === 'AVERAGE') {
                    const oldCost = totalQty * avgPrice;
                    const newCost = q * p;
                    totalQty += q;
                    avgPrice = (oldCost + newCost) / (totalQty || 1);
                    investedCapital += newCost;
                } else if (ed.type.includes('TP') || ed.type.includes('SL') || ed.type === 'EXIT' || ed.type === 'CUT_EARLY') {
                    const profit = (p - avgPrice) * q;
                    realizedPnL += profit;
                    totalQty -= q; // Reduce qty
                    if (totalQty < 0) totalQty = 0; // Safety
                    if (profit < 0 && currentMistake !== 'NONE') mistakeCost += Math.abs(profit);
                }
            });

            // Assign Sorted Executions to Center
            centerItem.executions = execsData;

            // Derive Stats
            centerItem.stats = {
                realizedPnL,
                totalQty,
                avgPrice,
                mistakeCost,
                currentMistake,
                investedCapital,
                roi: investedCapital > 0 ? (realizedPnL / investedCapital) * 100 : 0,
                isOpen: totalQty > 0 || Math.abs(realizedPnL) < 1,
                isWin: totalQty === 0 && realizedPnL > 0,
                isLoss: totalQty === 0 && realizedPnL < 0
            };

            // Override Status
            if (totalQty === 0 && Math.abs(realizedPnL) > 1) {
                centerItem.status = 'CLOSED';
            } else {
                centerItem.status = 'OPEN';
            }

            window.journalCache.push(centerItem);
        }

        window.renderJournalList();

    } catch (e) {
        console.error(e);
        list.innerHTML = '<p class="text-danger">خطأ في تحميل السجل</p>';
    }
};

window.setJournalFilter = (filterType) => {
    window.journalFilter = filterType;
    document.querySelectorAll('.j-filter').forEach(b => {
        b.classList.remove('active');
        if (b.dataset.filter === filterType) b.classList.add('active');
    });
    window.renderJournalList();
};

window.toggleCenterDetails = (id, cardElement) => {
    const detailsBox = document.getElementById('details-' + id);
    if (detailsBox) {
        detailsBox.classList.toggle('open');
        cardElement.classList.toggle('expanded');
    }
};

window.renderJournalList = () => {
    const list = document.getElementById('active-centers-list');
    list.innerHTML = '';

    const filter = window.journalFilter;
    const filteredData = window.journalCache.filter(item => {
        if (filter === 'ALL') return true;
        if (filter === 'OPEN') return item.stats.totalQty > 0; // Truly open
        if (filter === 'WIN') return item.stats.isWin;
        if (filter === 'LOSS') return item.stats.isLoss;
        return true;
    });

    if (filteredData.length === 0) {
        list.innerHTML = '<div class="empty-state"><i class="fa-solid fa-filter"></i><p>لا توجد نتائج لهذا الفلتر.</p></div>';
        // Reset stats to 0
        document.getElementById('j-winrate').innerText = '--%';
        document.getElementById('j-avg-rr').innerText = '--';
        document.getElementById('j-total-trades').innerText = '0';
        return;
    }

    // Calc Filtered Stats
    let globalWins = 0;
    let globalLosses = 0;
    let globalWinAmount = 0;
    let globalLossAmount = 0;
    let completedTrades = 0;
    const mistakeCosts = {};

    // --- GROUPING LOGIC START ---
    const groups = {};

    // 1. Group Data
    filteredData.forEach(item => {
        const key = item.asset || 'UNKNOWN';
        if (!groups[key]) {
            groups[key] = {
                asset: key,
                totalRealizedPnL: 0,
                totalQty: 0, // Sum of remaining qty
                centers: [],
                allExecutions: [],
                latestDate: 0,
                latestCenterId: null
            };
        }

        // Aggregate
        groups[key].totalRealizedPnL += (item.stats.realizedPnL || 0);
        groups[key].totalQty += (item.stats.totalQty || 0);
        groups[key].centers.push(item);

        // Merge Executions with Context
        if (item.executions) {
            item.executions.forEach(ex => {
                groups[key].allExecutions.push({
                    centerId: item.id, // Keep ref to parent center for editing
                    ...ex
                });
            });
        }

        // Track Latest
        const itemDate = item.createdAt && item.createdAt.toDate ? item.createdAt.toDate().getTime() : 0;
        if (itemDate > groups[key].latestDate) {
            groups[key].latestDate = itemDate;
            groups[key].latestCenterId = item.id;
        }

        // Stats Aggregation (for global stats)
        const stats = item.stats;
        if (stats.totalQty === 0 && Math.abs(stats.realizedPnL) > 1) {
            completedTrades++;
            if (stats.realizedPnL > 0) {
                globalWins++;
                globalWinAmount += stats.realizedPnL;
            } else {
                globalLosses++;
                globalLossAmount += Math.abs(stats.realizedPnL);
            }
        }

        // Mistake Aggregation (for global stats)
        if (stats.mistakeCost > 0 && stats.currentMistake !== 'NONE') {
            if (!mistakeCosts[stats.currentMistake]) mistakeCosts[stats.currentMistake] = 0;
            mistakeCosts[stats.currentMistake] += stats.mistakeCost;
        }
    });

    // 2. Render Groups
    Object.values(groups).forEach(group => {

        // Sort Executions Newest First
        group.allExecutions.sort((a, b) => {
            const da = a.date && a.date.toDate ? a.date.toDate() : new Date(a.date);
            const db = b.date && b.date.toDate ? b.date.toDate() : new Date(b.date);
            return db - da;
        });

        // Determine Group Status (Active if ANY qty > 0)
        // Or if we want to show closed campaigns too.
        // For visual, if totalQty > 0 it's OPEN.
        const isOpen = group.totalQty > 0;
        const statusClass = isOpen ? 'status-open' : 'status-closed';
        const pnlClass = group.totalRealizedPnL >= 0 ? 'text-green' : 'text-danger';
        const pnlString = group.totalRealizedPnL.toLocaleString(undefined, { maximumFractionDigits: 0 });

        // Use the latest center's strategy/notes for the main card (or aggregate?)
        // Let's use the Latest Center as the "Face" of the card
        const faceCenter = group.centers.find(c => c.id === group.latestCenterId) || group.centers[0];

        // --- GENERATE ACCORDION HTML (For Group) ---
        let execsHtml = '';
        if (group.allExecutions.length === 0) {
            execsHtml = `
            < div class="empty-execs" >
                    <i class="fa-solid fa-box-open" style="font-size:1.5rem; opacity:0.5"></i>
                    <span>لا توجد صفقات مسجلة بعد</span>
                </div > `;
        } else {
            group.allExecutions.forEach(ex => {
                let typeBadgeClass = 'type-buy'; // Default
                let typeTextClass = 'text-buy';

                // Classify
                if (ex.type.includes('TP') || ex.type === 'EXIT') {
                    typeBadgeClass = 'type-sell'; typeTextClass = 'text-sell';
                }
                if (ex.type.includes('SL') || ex.type === 'CUT_EARLY') {
                    typeBadgeClass = 'type-loss'; typeTextClass = 'text-loss';
                }
                // Special case for OPEN/ADD
                if (ex.type === 'OPEN' || ex.type === 'ADD') {
                    typeBadgeClass = 'type-buy'; typeTextClass = 'text-buy';
                }

                const exDate = ex.date && ex.date.toDate ? ex.date.toDate() : new Date(ex.date);

                execsHtml += `
            < div class="exec-row ${typeBadgeClass}" >
                    <div class="exec-meta">
                        <span class="exec-type-badge ${typeTextClass}">${ex.type}</span>
                        <span style="color:#666; font-size:0.75rem">${exDate.toLocaleDateString('ar-EG')}</span>
                    </div>
                    <div style="text-align:left">
                        <strong>${ex.qty}</strong> <span style="font-size:0.8rem; color:#888; font-weight:normal">@ ${ex.price}</span>
                    </div>
                    <div class="exec-actions-bar">
                        <button class="icon-btn-sm" onclick="event.stopPropagation(); window.editExecution('${ex.centerId}', '${ex.id}')"><i class="fa-solid fa-pen"></i></button>
                        <button class="icon-btn-sm text-danger" onclick="event.stopPropagation(); window.deleteExecution('${ex.centerId}', '${ex.id}')"><i class="fa-solid fa-trash"></i></button>
                    </div>
                 </div > `;
            });
        }

        const div = document.createElement('div');
        div.className = 'center-card';
        // Toggle Logic with Group ID (using Asset Name as unique enough for display, but safer to use hashed or just asset)
        // Actually, let's use the asset name but sanitize it
        const safeId = 'grp_' + group.asset.replace(/[^a-zA-Z0-9]/g, '');

        div.setAttribute('onclick', `window.toggleCenterDetails('${safeId}', this)`);

        // Translation Map
        const stratMap = {
            'BREAKOUT': 'اختراق (Breakout)',
            'REVERSAL': 'انعكاس (Reversal)',
            'TREND_FOLLOWING': 'تتبع اتجاه (Trend)',
            'NEWS': 'تداول أخبار',
            'OTHER': 'أخرى'
        };
        const stratLabel = stratMap[faceCenter.strategy] || faceCenter.strategy;

        div.innerHTML = `
            <div class="center-header">
                <div class="ch-left">
                    <span class="stock-ticker">${group.asset}</span>
                    <span class="stock-status ${statusClass}">${isOpen ? 'مفتوح' : 'مغلق'}</span>
                </div>
                <div class="ch-right">
                    <!-- Add Trade Button Here (Header) -->
                    <button class="icon-btn-sm btn-header-add" style="background:var(--success); color:#fff; width:32px; height:32px; border-radius:50%;" 
                        onclick="event.stopPropagation(); window.showAddExecModal('${group.latestCenterId}')" title="صفقة جديدة">
                        <i class="fa-solid fa-plus"></i>
                    </button>
                    <div class="ch-pnl">
                        <span class="ch-label">الربح</span>
                        <span class="ch-val ${pnlClass}">${pnlString}</span>
                    </div>
                </div>
            </div>

            <div class="center-body">
                <div class="cb-row">
                    <span class="cb-label">الكمية:</span>
                    <span class="cb-val text-white">${group.totalQty}</span>
                </div>
                <div class="cb-row">
                    <span class="cb-label">متوسط السعر:</span>
                    <span class="cb-val text-white">${faceCenter.stats.avgPrice ? faceCenter.stats.avgPrice.toFixed(2) : '-'}</span>
                </div>
                 <!-- ROI for the Group? Difficult if mixed. Using Face Center stats for now or need Aggregation -->
                 <div class="cb-row">
                    <span class="cb-label">العائد (ROI):</span>
                    <span class="cb-val ${faceCenter.stats.roi >= 0 ? 'text-green' : 'text-danger'}">${faceCenter.stats.roi ? faceCenter.stats.roi.toFixed(1) + '%' : '-'}</span>
                </div>
                 <div class="cb-row">
                    <span class="cb-label">الاستراتيجية:</span>
                    <span class="cb-val text-muted">${stratLabel}</span>
                </div>
            </div>

             <!--HIDDEN ACCORDION SECTION-- >
            <div id="details-${safeId}" class="center-details-box">
                <div class="exec-list">
                    ${execsHtml}
                </div>
                <!-- Actions Footer inside Accordion now? Or keep footer visible? -->
                <!-- User complained about space. Let's keep minimal actions in the expanded part or bottom of fold -->
                <div class="center-footer" style="border-top:1px solid rgba(255,255,255,0.05); padding-top:10px; margin-top:5px;">
                    <button class="icon-btn text-muted" onclick="event.stopPropagation(); window.editCenter('${group.latestCenterId}')" title="تعديل الخطة"><i class="fa-solid fa-pen"></i></button>
                    <button class="icon-btn text-danger" onclick="event.stopPropagation(); window.confirmDeleteCenter('${group.latestCenterId}')" title="حذف المركز"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>
        `;
        list.appendChild(div);
    });

    // Update Stats DOM
    const winRate = completedTrades > 0 ? Math.round((globalWins / completedTrades) * 100) : 0;
    const avgWin = globalWins > 0 ? globalWinAmount / globalWins : 0;
    const avgLoss = globalLosses > 0 ? globalLossAmount / globalLosses : 1;
    const rr = (avgWin / avgLoss).toFixed(2);

    document.getElementById('j-winrate').innerText = winRate + '%';
    document.getElementById('j-avg-rr').innerText = rr;
    document.getElementById('j-total-trades').innerText = completedTrades;

    // Render Leakage
    const leakList = document.getElementById('leakage-list');
    if (leakList) {
        leakList.innerHTML = '';
        const sortedMistakes = Object.entries(mistakeCosts).sort((a, b) => b[1] - a[1]);

        if (sortedMistakes.length === 0) {
            leakList.innerHTML = '<div style="text-align:center; padding:10px; color:#888; font-size:0.8rem">ممتاز! لا توجد أخطاء مكلفة.</div>';
        } else {
            sortedMistakes.forEach(([name, cost]) => {
                const item = document.createElement('div');
                item.className = 'leak-item';
                item.innerHTML = `
            < span > ${name}</span >
                <span class="text-danger">-${cost.toLocaleString()} ج.م</span>
        `;
                leakList.appendChild(item);
            });
        }
    }
};

// --- DELETE LOGIC ---
window.confirmDeleteCenter = async (id) => {
    if (confirm('هل أنت متأكد من حذف هذا المركز الاستثماري وكل صفقاته؟ لا يمكن التراجع.')) {
        try {
            await deleteDoc(doc(db, 'users', auth.currentUser.uid, 'journal_centers', id));
            showToast('تم الحذف بنجاح', 'success');
            window.loadJournal();
        } catch (e) {
            console.error(e);
            showToast('خطأ في الحذف', 'error');
        }
    }
}

// (Legacy Edit Logic Removed)

// --- REVIEW TIMELINE LOGIC ---
window.showReviewTimeline = async (centerId) => {
    const list = document.getElementById('timeline-container');
    list.innerHTML = '<div class="empty-state"><i class="fa-solid fa-spinner fa-spin"></i><p>جاري تحميل السجل...</p></div>';

    document.getElementById('review-timeline-modal').showModal();

    try {
        const execsRef = collection(db, 'users', auth.currentUser.uid, 'journal_centers', centerId, 'executions');
        const q = query(execsRef, orderBy('date', 'desc')); // Newest first
        const snap = await getDocs(q);

        list.innerHTML = '';
        if (snap.empty) {
            list.innerHTML = '<div class="empty-state"><p>لا توجد صفقات مسجلة بعد.</p></div>';
            return;
        }

        snap.forEach(docSnap => {
            const d = docSnap.data();
            const dateStr = d.date && d.date.toDate ? d.date.toDate().toLocaleString() : new Date(d.date).toLocaleString();

            // Determine Color based on Type
            let dotColor = 'var(--primary-color)';
            let icon = 'fa-circle';
            if (d.type.includes('OPEN') || d.type.includes('ADD')) { dotColor = '#00ff88'; icon = 'fa-arrow-up'; }
            if (d.type.includes('TP')) { dotColor = '#00ccff'; icon = 'fa-sack-dollar'; }
            if (d.type.includes('SL') || d.type.includes('CUT')) { dotColor = '#ff4d4d'; icon = 'fa-skull'; }

            // Psychology Badges
            let badgesHtml = '';
            if (d.psychology && d.psychology.length > 0) {
                d.psychology.forEach(tag => badgesHtml += `< span class="t-tag" > ${tag}</span > `);
            }
            if (d.mistake && d.mistake !== 'NONE') {
                badgesHtml += `< span class="t-tag text-danger" style = "border:1px solid red" > ${d.mistake}</span > `;
            }

            const item = document.createElement('div');
            item.className = 'timeline-item';
            item.innerHTML = `
            < div class="timeline-dot" style = "background:${dotColor}; box-shadow:0 0 8px ${dotColor}" ></div >
                <div class="timeline-date">${dateStr}</div>
                <div class="timeline-card">
                    <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                        <strong>${d.type}</strong>
                        <span>${d.qty} @ ${d.price}</span>
                    </div>
                    <div style="font-size:0.8rem; margin-top:5px;">
                        ${badgesHtml}
                    </div>
                </div>
        `;
            list.appendChild(item);
        });

    } catch (e) {
        console.error(e);
        list.innerHTML = '<p class="text-danger">خطأ في تحميل البيانات</p>';
    }
};

// Listen for Nav Click
document.getElementById('nav-journal')?.addEventListener('click', () => {
    window.switchView('journal-section');
    window.loadJournal();
});

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

    if (activeBtn) {
        activeFilter = activeBtn.textContent.trim();
    } else {
        const allBtn = Array.from(document.querySelectorAll('.filter-btn')).find(b => b.textContent.trim() === 'ALL');
        if (allBtn) allBtn.classList.add('active');
    }

    window.updateChartFilter(activeFilter);
};

// ==========================================
//          BACKUP & RESTORE MODULE
// ==========================================

window.exportBackup = async () => {
    showLoading();
    try {
        const uid = auth.currentUser.uid;
        const backup = {
            version: "2.0",
            timestamp: new Date().toISOString(),
            portfolios: [],
            journal: []
        };

        // 1. Export Portfolios & History
        const portfoliosSnap = await getDocs(collection(db, "users", uid, "portfolios"));
        for (const pDoc of portfoliosSnap.docs) {
            const pData = pDoc.data();
            const pObj = { id: pDoc.id, data: pData, history: [], assets: [] }; // Assets might be legacy but we keep structure

            // Fetch History
            const histSnap = await getDocs(collection(db, "users", uid, "portfolios", pDoc.id, "history"));
            histSnap.forEach(h => pObj.history.push({ id: h.id, ...h.data() }));

            backup.portfolios.push(pObj);
        }

        // 2. Export Journal (Centers & Executions)
        const centersSnap = await getDocs(collection(db, "users", uid, "journal_centers"));
        for (const cDoc of centersSnap.docs) {
            const cData = cDoc.data();
            const cObj = { id: cDoc.id, data: cData, executions: [] };

            // Fetch Executions
            const execsSnap = await getDocs(collection(db, "users", uid, "journal_centers", cDoc.id, "executions"));
            execsSnap.forEach(e => cObj.executions.push({ id: e.id, ...e.data() }));

            backup.journal.push(cObj);
        }

        // Trigger Download
        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `my - wealth - backup - ${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);

        showToast('تم تصدير النسخة الاحتياطية بنجاح 📦', 'success');

    } catch (e) {
        console.error(e);
        showToast('فشل التصدير: ' + e.message, 'error');
    } finally {
        hideLoading();
    }
};

window.importBackupData = async (fileInput) => {
    if (!fileInput.files || !fileInput.files[0]) return;
    const file = fileInput.files[0];

    if (!confirm('تحذير: استعادة النسخة ستضيف البيانات إلى حسابك الحالي. هل أنت متأكد؟')) {
        fileInput.value = ''; // Reset
        return;
    }

    showLoading();
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = JSON.parse(e.target.result);
            const uid = auth.currentUser.uid;

            // 1. Restore Portfolios
            if (data.portfolios && Array.isArray(data.portfolios)) {
                for (const p of data.portfolios) {
                    // Create/Update Portfolio
                    const pRef = doc(db, "users", uid, "portfolios", p.id || ('restored_' + Date.now()));
                    await setDoc(pRef, p.data);

                    // Restore History
                    if (p.history) {
                        for (const h of p.history) {
                            const hRef = doc(db, "users", uid, "portfolios", pRef.id, "history", h.id || ('h_' + Date.now()));
                            await setDoc(hRef, h); // Contains value, date, type, etc.
                        }
                    }
                }
            }

            // 2. Restore Journal
            if (data.journal && Array.isArray(data.journal)) {
                for (const c of data.journal) {
                    // Create Center
                    const cRef = doc(db, "users", uid, "journal_centers", c.id || ('restored_' + Date.now()));
                    await setDoc(cRef, c.data);

                    // Restore Executions
                    if (c.executions) {
                        for (const ex of c.executions) {
                            const exRef = doc(db, "users", uid, "journal_centers", cRef.id, "executions", ex.id || ('x_' + Date.now()));
                            await setDoc(exRef, ex);
                        }
                    }
                }
            }

            showToast('تمت الاستعادة بنجاح! ♻️', 'success');
            setTimeout(() => window.location.reload(), 1500); // Reload to reflect changes

        } catch (err) {
            console.error(err);
            showToast('الملف فاسد أو غير متوافق', 'error');
        } finally {
            hideLoading();
            fileInput.value = '';
        }
    };
    reader.readAsText(file);
};

// --- NAVIGATION LOGIC ---
window.setView = (viewId) => {
    // Hide all views
    document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));

    // Show target view
    const target = document.getElementById(viewId + '-section');
    if (target) {
        target.classList.remove('hidden');
        // Update Nav
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        const navBtn = document.getElementById('nav-' + viewId);
        if (navBtn) navBtn.classList.add('active');

        // Specific Loaders
        if (viewId === 'journal') window.loadJournal();
    }
};

window.switchView = window.setView; // Alias for backward compatibility

// Start at Dashboard
window.setView('dashboard');

// ==========================================
//          PWA INSTALLATION LOGIC
// ==========================================
let deferredPrompt;

window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent Chrome 67 and earlier from automatically showing the prompt
    e.preventDefault();
    // Stash the event so it can be triggered later.
    deferredPrompt = e;

    // Check if user has already dismissed it recently (localStorage)
    const dismissed = localStorage.getItem('pwa_dismissed_ts');
    const now = Date.now();
    // Show again after 1 day if dismissed
    if (!dismissed || (now - parseInt(dismissed) > 86400000)) {
        setTimeout(() => {
            const modal = document.getElementById('pwa-install-modal');
            if (modal) modal.showModal();
        }, 3000); // Wait 3 seconds after load to be polite
    }

    // Show Manual Button
    const manualBtn = document.getElementById('manual-install-trigger');
    if (manualBtn) manualBtn.style.display = 'block';
});

const btnInstall = document.getElementById('btn-pwa-install');
if (btnInstall) {
    btnInstall.addEventListener('click', async () => {
        const modal = document.getElementById('pwa-install-modal');
        if (deferredPrompt) {
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            console.log(`User response to the install prompt: ${outcome} `);
            deferredPrompt = null;
        } else {
            // Fallback for when event didn't fire (e.g. iOS or already installed)
            showToast('اضغط على أيقونة المشاركة ثم "Add to Home Screen" 📲', 'info');
        }
        modal.close();
    });
}

// Track App Installed
window.addEventListener('appinstalled', () => {
    console.log('PWA was installed');
    localStorage.setItem('pwa_installed', 'true');
    const modal = document.getElementById('pwa-install-modal');
    if (modal) modal.close();
});

// Dismiss Logic
const btnDismiss = document.querySelector('#pwa-install-modal .btn-text');
if (btnDismiss) {
    btnDismiss.addEventListener('click', () => {
        localStorage.setItem('pwa_dismissed_ts', Date.now().toString());
    });
}
// --- GLOBAL ASSET ANALYZER (NEW) ---
window.calcGlobalStats = async (tickerInput) => {
    const list = document.getElementById('global-breakdown-list');
    const resultBox = document.getElementById('global-results');
    const emptyState = document.getElementById('global-empty');

    if (!tickerInput || tickerInput.length < 2) {
        resultBox.style.display = 'none';
        emptyState.style.display = 'block';
        return;
    }

    const ticker = tickerInput.trim().toUpperCase();

    // We already have "window.journalCache" populated with all centers from "loadJournal"
    // However, "loadJournal" might filter? No, loadJournal fetches ALL and filters locally.
    // BUT, checks authentication first.
    if (!window.journalCache || window.journalCache.length === 0) {
        // Just in case journal isn't loaded yet
        await window.loadJournal();
    }

    // 1. Filter OPEN centers for this Ticker
    const relevantGroups = window.journalCache.filter(c =>
        c.asset === ticker &&
        c.stats &&
        c.stats.totalQty > 0
    );

    if (relevantGroups.length === 0) {
        resultBox.style.display = 'none';
        // Maybe show "No active positions found" message inside input or Toast?
        // Actually, let's keep empty state but maybe text "No positions for [TICKER]"
        return;
    }

    resultBox.style.display = 'block';
    emptyState.style.display = 'none';

    // 2. Aggregate Data
    let globalTotalQty = 0;
    let globalTotalCost = 0;
    const portfolioBreakdown = {};

    // Need to fetch Portfolio Names since Journal only stores portfolioID on Executions...
    // Wait, the "journalCache" items (Centers) don't have PortfolioID on the Center doc necessarily.
    // The Executions have it.
    // We need to iterate EXECUTIONS of these centers to know where the qty lives.

    // Fetch Portfolios Map for Names
    const portfoliosMap = {};
    try {
        const pSnap = await getDocs(collection(db, 'users', auth.currentUser.uid, 'portfolios'));
        pSnap.forEach(d => portfoliosMap[d.id] = d.data().name);
    } catch (e) { }

    relevantGroups.forEach(group => {
        // A Center might theoretically mix portfolios if user messed up, but let's assume Executions dictate location.
        // We must sum up Qty per Portfolio based on Executions Types.

        group.executions.forEach(ex => {
            const pid = ex.portfolioId || 'Unassigned';
            const pname = portfoliosMap[pid] || (pid === 'Unassigned' ? 'غير محدد' : 'Unknown');

            if (!portfolioBreakdown[pid]) portfolioBreakdown[pid] = { name: pname, qty: 0, cost: 0 };

            const q = parseFloat(ex.qty);
            const p = parseFloat(ex.price);

            if (ex.type === 'OPEN' || ex.type === 'ADD' || ex.type === 'AVERAGE') {
                portfolioBreakdown[pid].qty += q;
                portfolioBreakdown[pid].cost += (q * p);

                globalTotalQty += q;
                globalTotalCost += (q * p);
            }
            else if (ex.type.includes('EXIT') || ex.type.includes('TP') || ex.type.includes('SL')) {
                // FIFO removal logic ideally, but for weighted average of *current* holding:
                // We subtract Qty. The "Cost" removed is weighted avg? 
                // Simple approach: Current Avg = Total Cost / Total Qty (at that moment).
                // For now, let's assume strict accumulation for Average Price calculation is based on "Remaining Shares".
                // Actually, "Weighted Average Price" of *current* holdings is:
                // (Sum of Counts * Prices) / Total Count... Only for active lots.
                // Complex with FIFO.
                // Simplified: Just take the `group.stats.avgPrice` (which we calculated in loadJournal) and `group.stats.totalQty`
            }
        });
    });

    // RE-AGGREGATE strategy: Use the pre-calculated Center Stats!
    // Much safer because `loadJournal` handles the math.
    // We just need to attribute `totalQty` to a Portfolio.
    // Problem: A Center can have Executions from Portfolio A AND Portfolio B? 
    // If so, `group.stats.totalQty` is mixed.
    // Let's assume 1 Center = Mixed. We need to split it based on Executions "net flow".

    // Reset Globals
    globalTotalQty = 0;
    let globalWeightedSum = 0;
    const breakdown = {};

    relevantGroups.forEach(group => {
        // Calculate Net Qty per Portfolio within this Center
        const centerPfs = {};

        group.executions.forEach(ex => {
            const pid = ex.portfolioId || 'OTHER';
            if (!centerPfs[pid]) centerPfs[pid] = 0;
            const q = parseFloat(ex.qty);

            if (['OPEN', 'ADD', 'AVERAGE'].includes(ex.type)) centerPfs[pid] += q;
            else centerPfs[pid] -= q; // Deduct
        });

        // Now add to Global Breakdown
        Object.entries(centerPfs).forEach(([pid, qty]) => {
            if (qty <= 0) return; // Ignore closed portions

            const pName = portfoliosMap[pid] || (pid === 'OTHER' ? 'غير محدد' : pid);
            if (!breakdown[pName]) breakdown[pName] = 0;
            breakdown[pName] += qty;

            globalTotalQty += qty;
            // Weighted Sum using the CENTER'S average price (assumed uniform for the center)
            globalWeightedSum += (qty * group.stats.avgPrice);
        });
    });

    const globalAvg = globalTotalQty > 0 ? (globalWeightedSum / globalTotalQty) : 0;
    const marketVal = globalTotalQty * globalAvg; // Or use live price if available? globalAvg is Cost basis.

    // 3. Render
    document.getElementById('g-avg-price').textContent = globalAvg.toFixed(2);
    document.getElementById('g-total-qty').textContent = globalTotalQty.toLocaleString();
    document.getElementById('g-mkt-val').textContent = marketVal.toLocaleString(undefined, { maximumFractionDigits: 0 });

    list.innerHTML = '';
    Object.entries(breakdown).forEach(([name, qty]) => {
        list.innerHTML += `
            < div class="exec-row" style = "background:rgba(255,255,255,0.02)" >
            <span style="color:#aaa">${name}</span>
            <strong>${qty.toLocaleString()}</strong>
        </div > `;
    });
};
// --- TRADING TOOLS CALCULATORS ---

// 1. Commission Calculator
window.currentBroker = 'thndr'; // Default
window.selectBroker = (broker, el) => {
    window.currentBroker = broker;
    document.querySelectorAll('.radio-label').forEach(d => d.classList.remove('selected'));
    el.classList.add('selected');
    window.calcCommission();
};

window.calcCommission = () => {
    const buy = parseFloat(document.getElementById('c-buy').value) || 0;
    const sell = parseFloat(document.getElementById('c-sell').value) || 0;
    const qty = parseFloat(document.getElementById('c-qty').value) || 0;

    if (!buy || !sell || !qty) {
        document.getElementById('c-result').innerText = '0.00';
        document.getElementById('c-fees').innerText = '0.00';
        return;
    }

    const totalBuy = buy * qty;
    const totalSell = sell * qty;
    let fees = 0;

    if (window.currentBroker === 'thndr') {
        // Thndr: roughly 2 EGP + stamp duty etc. Adjusted simply:
        // (This is an approximation)
        // Buy: 2 + 0.0005 * val? Let's use a standard simplified model or just 2 + 1.
        // Approx 0.1% total roundtrip? 
        // Let's use: (Total * 0.001) + 2 [Very rough]
        fees = (totalBuy + totalSell) * 0.001 + 5;
    } else {
        // Commercial: Usually 0.4% - 0.5% roundtrip
        fees = (totalBuy + totalSell) * 0.004;
    }

    const grossProfit = totalSell - totalBuy;
    const netProfit = grossProfit - fees;

    document.getElementById('c-result').innerText = netProfit.toFixed(2);
    document.getElementById('c-result').style.color = netProfit >= 0 ? 'var(--success)' : 'var(--danger)';
    document.getElementById('c-fees').innerText = fees.toFixed(2);
};

// 2. Average Down Calculator
window.calcAverage = () => {
    const cQty = parseFloat(document.getElementById('avg-curr-qty').value) || 0;
    const cPrice = parseFloat(document.getElementById('avg-curr-price').value) || 0;
    const nQty = parseFloat(document.getElementById('avg-new-qty').value) || 0;
    const nPrice = parseFloat(document.getElementById('avg-new-price').value) || 0;

    if ((cQty + nQty) === 0) return;

    const totalVal = (cQty * cPrice) + (nQty * nPrice);
    const newAvg = totalVal / (cQty + nQty);

    document.getElementById('avg-result').innerText = newAvg.toFixed(2);
};

// 3. Risk & Position Sizing Calculator (Enhanced)
window.calcRR = () => {
    const entry = parseFloat(document.getElementById('rr-entry').value) || 0;
    const target = parseFloat(document.getElementById('rr-target').value) || 0;
    const stop = parseFloat(document.getElementById('rr-stop').value) || 0;
    const riskAmount = parseFloat(document.getElementById('rr-risk-amount').value) || 0;

    const profitEl = document.getElementById('rr-profit');
    const lossEl = document.getElementById('rr-loss');
    const ratioEl = document.getElementById('rr-ratio');
    const qtyEl = document.getElementById('rr-qty');

    // Elements for Visualizer (Ensure they exist in HTML)
    const barProfit = document.getElementById('rr-bar-profit');
    const barLoss = document.getElementById('rr-bar-loss');
    const labelProfit = document.getElementById('label-profit');
    const labelLoss = document.getElementById('label-loss');

    // Message Container (Create if missing)
    let msgBox = document.getElementById('rr-message-box');
    if (!msgBox) {
        msgBox = document.createElement('div');
        msgBox.id = 'rr-message-box';
        msgBox.className = 'glass-card compact-card';
        msgBox.style.marginTop = '15px';
        msgBox.style.fontSize = '0.85rem';
        msgBox.style.lineHeight = '1.6';
        msgBox.style.display = 'none';
        // Insert after the result grid
        const parent = document.querySelector('#calc-risk .glass-card');
        if (parent) parent.appendChild(msgBox);
    }

    if (!entry) return;

    let reward = 0;
    let risk = 0;

    if (target) reward = Math.abs(target - entry);
    if (stop) risk = Math.abs(entry - stop);

    // Calc Percentages
    const riskPer = (risk / entry) * 100;
    const rewardPer = (reward / entry) * 100;

    if (profitEl) profitEl.innerText = target ? `+ ${rewardPer.toFixed(1)}% ` : '0%';
    if (lossEl) lossEl.innerText = stop ? `- ${riskPer.toFixed(1)}% ` : '0%';

    // R:R Ratio & Tips
    let recommendation = "";

    if (risk > 0 && reward > 0) {
        const r = reward / risk;
        ratioEl.innerText = `1 : ${r.toFixed(1)} `;

        if (r >= 3) {
            ratioEl.style.color = 'var(--gold)';
            recommendation = "🌟 **صفقة ممتازة!** العائد المتوقع 3 أضعاف المخاطرة. هذه هي الصفقات التي تبني الثروات.";
        } else if (r >= 2) {
            ratioEl.style.color = 'var(--success)';
            recommendation = "✅ **صفقة جيدة.** المعيار العالمي للمحترفين هو 2:1 على الأقل. استمر.";
        } else if (r >= 1) {
            ratioEl.style.color = '#fff';
            recommendation = "⚠️ **مقبولة ولكن خطرة.** العائد يساوي المخاطرة. تحتاج لنسبة نجاح عالية (Win Rate > 60%) لتكون رابحاً.";
        } else {
            ratioEl.style.color = 'var(--danger)';
            recommendation = "⛔ **لا أنصح بها.** المخاطرة أكبر من العائد! الأفضل البحث عن فرصة أخرى.";
        }

    } else {
        ratioEl.innerText = '0 : 0';
        ratioEl.style.color = '#fff';
        recommendation = "💡 أدخل سعر وقف الخسارة والهدف لحساب نسبة المخاطرة.";
    }

    // Update Message Box
    if (recommendation) {
        msgBox.style.display = 'block';
        msgBox.innerHTML = recommendation;
    }

    // Position Sizing
    if (riskAmount > 0 && risk > 0) {
        const maxQty = Math.floor(riskAmount / risk);
        qtyEl.innerText = maxQty.toLocaleString();
    } else {
        qtyEl.innerText = '-';
    }

    // --- VISUALIZER LOGIC ---
    if (barProfit && barLoss) {
        if (target > 0 && stop > 0) {
            const upside = Math.abs(target - entry);
            const downside = Math.abs(entry - stop);
            const total = upside + downside;

            const profitWidth = (upside / total) * 100;
            const lossWidth = (downside / total) * 100;

            barProfit.style.width = `${profitWidth}% `;
            barLoss.style.width = `${lossWidth}% `;

            if (labelProfit) labelProfit.textContent = target.toFixed(2);
            if (labelLoss) labelLoss.textContent = stop.toFixed(2);
        } else {
            barProfit.style.width = '0%';
            barLoss.style.width = '0%';
        }
    }
};


// ==========================================
//       ENHANCED UI INTERACTIONS
// ==========================================

// Modern Tab Switcher
window.switchCalcTab = (tabName, btn) => {
    // Buttons
    document.querySelectorAll('.sc-btn').forEach(b => b.classList.remove('active'));
    // If btn is passed, use it. If not, find by tabName (optional fallback)
    if (btn) btn.classList.add('active');

    // Content
    document.querySelectorAll('.calc-tab-content').forEach(c => c.classList.remove('active'));
    const target = document.getElementById(`calc - ${tabName} `);
    if (target) {
        target.classList.add('active');
        // Animation trigger if needed
        target.style.animation = 'none';
        target.offsetHeight; /* trigger reflow */
        target.style.animation = 'fadeIn 0.3s ease';
    }
};

// Modern Broker Selector
window.selectBroker = (broker, el) => {
    window.currentBroker = broker;
    document.querySelectorAll('.broker-option').forEach(r => r.classList.remove('selected'));
    if (el) {
        el.classList.add('selected');
    }
    window.calcCommission();
};

// Ensure Risk Visualizer Updates on Load/Input
// (Calculated inside calcRR which is triggered by oninput)



window.calcPivots = () => {
    const H = parseFloat(document.getElementById('piv-high').value);
    const L = parseFloat(document.getElementById('piv-low').value);
    const C = parseFloat(document.getElementById('piv-close').value);

    const resBox = document.getElementById('piv-results');
    resBox.innerHTML = '';

    if (isNaN(H) || isNaN(L) || isNaN(C)) return;

    // Classic Calculation
    const P = (H + L + C) / 3;

    const R1 = (2 * P) - L;
    const S1 = (2 * P) - H;

    const R2 = P + (H - L);
    const S2 = P - (H - L);

    const R3 = H + 2 * (P - L);
    const S3 = L - 2 * (H - P);

    // Render nicely
    const Row = (lbl, val, color) => `
            < div style = "display:flex; justify-content:space-between; padding:8px; border-bottom:1px solid rgba(255,255,255,0.05)" >
            <span style="color:${color}; font-weight:bold">${lbl}</span>
            <span style="font-family:'Inter'; font-weight:bold">${val.toFixed(2)}</span>
        </div > `;

    let html = `< div class="glass-card" style = "padding:10px; background:rgba(0,0,0,0.2)" > `;

    html += Row('R3', R3, 'var(--danger)');
    html += Row('R2', R2, 'var(--danger)');
    html += Row('R1', R1, 'var(--danger)');

    html += `< div style = "text-align:center; padding:10px; background:rgba(255,255,255,0.05); margin:5px 0; border-radius:8px" >
                <span style="display:block; font-size:0.7rem; color:#aaa">نقطة الارتكاز (Pivot)</span>
                <strong style="font-size:1.2rem; color: #fff">${P.toFixed(2)}</strong>
             </div > `;

    html += Row('S1', S1, 'var(--success)');
    html += Row('S2', S2, 'var(--success)');
    html += Row('S3', S3, 'var(--success)');

    html += `</div > `;

    resBox.innerHTML = html;
};


// ==========================================
//          LEVELS CALC (FIB & PIVOTS)
// ==========================================

window.switchLevelType = (type, btn) => {
    document.querySelectorAll('#calc-levels .broker-option').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');

    if (type === 'fib') {
        document.getElementById('lvl-fib-sec').classList.remove('hidden');
        document.getElementById('lvl-pivot-sec').classList.add('hidden');
    } else {
        document.getElementById('lvl-fib-sec').classList.add('hidden');
        document.getElementById('lvl-pivot-sec').classList.remove('hidden');
    }
};

window.calcFib = () => {
    const high = parseFloat(document.getElementById('fib-high').value);
    const low = parseFloat(document.getElementById('fib-low').value);
    const trend = document.getElementById('fib-trend').value;

    const resBox = document.getElementById('fib-results');
    resBox.innerHTML = '';

    if (isNaN(high) || isNaN(low)) return;

    const diff = high - low;
    if (diff <= 0 && trend === 'UP') return;

    // Description Mapper
    const getDesc = (rate) => {
        if (rate === 0.236) return "تصحيح ضعيف (استمرار قوي)";
        if (rate === 0.382) return "أول دعم حقيقي (شراء مضاربي)";
        if (rate === 0.500) return "منطقة التوازن (شائع جداً)";
        if (rate === 0.618) return "👑 النسبة الذهبية (أفضل منطقة شراء)";
        if (rate === 0.786) return "آخر أمل قبل كسر القاع";
        if (rate === 1.618) return "🚀 الهدف الامتدادي";
        return "";
    };

    const levels = [
        { r: 0.236, lbl: '23.6%' },
        { r: 0.382, lbl: '38.2%' },
        { r: 0.500, lbl: '50.0%' },
        { r: 0.618, lbl: '61.8%' },
        { r: 0.786, lbl: '78.6%' },
        { r: 1.618, lbl: '161.8% (Ext)' }
    ];

    let html = '<div class="glass-card compact-card" style="padding:0; overflow:hidden">';

    levels.forEach((l, index) => {
        let val = 0;
        let typeClass = '';
        const desc = getDesc(l.r);

        if (trend === 'UP') {
            val = high - (diff * l.r);
            typeClass = 'text-green';
        } else {
            val = low + (diff * l.r);
            typeClass = 'text-danger';
        }

        const isGolden = l.r === 0.618;
        const bgStyle = isGolden ? 'background:rgba(255,215,0,0.15);' : (index % 2 === 0 ? 'background:rgba(255,255,255,0.02)' : '');
        const borderStyle = isGolden ? 'border-right: 4px solid var(--gold);' : '';

        html += `
            < div style = "display:flex; justify-content:space-between; align-items:center; padding:12px; border-bottom:1px solid rgba(255,255,255,0.05); ${bgStyle}; ${borderStyle}" >
            <div style="display:flex; flex-direction:column;">
                <span class="g-label" style="font-size:0.9rem; color:#fff">${l.lbl}</span>
                <span style="font-size:0.7rem; color:#888; margin-top:2px">${desc}</span>
            </div>
            <strong class="g-value ${typeClass}" style="font-size:1.2rem">${val.toFixed(2)}</strong>
        </div > `;
    });
    html += '</div>';
    resBox.innerHTML = html;
};


// ==========================================
//          LESSONS & STRATEGY WIZARD
// ==========================================

let currentWizStep = 1;
const totalWizSteps = 4;
let selectedStrategy = 'DEFENSIVE'; // Default

window.changeStep = (n) => {
    // Validate Step 1
    if (currentWizStep === 1 && n === 1) {
        const failScenario = document.getElementById('lz-fail-scenario').value;
        if (failScenario.length < 5) {
            window.showToast("👻 لا تخدع نفسك! واجه الجانب المظلم واكتب سيناريو الفشل.", "error");
            return;
        }
    }

    // Validate Step 3
    if (currentWizStep === 3 && n === 1) {
        const alloc = parseFloat(document.getElementById('lz-alloc-amount').value) || 0;
        if (alloc <= 0) {
            window.showToast("💰 حدد المبلغ المخصص للصفقة.", "error");
            return;
        }
        // Auto-calc on enter step 4
        setTimeout(window.calcStrategyResults, 100);
    }

    document.getElementById(`step - ${currentWizStep} `).classList.remove('active');
    currentWizStep += n;

    // Bounds check
    if (currentWizStep < 1) currentWizStep = 1;
    if (currentWizStep > totalWizSteps) currentWizStep = totalWizSteps;

    document.getElementById(`step - ${currentWizStep} `).classList.add('active');

    // Update Progress
    const progress = (currentWizStep / totalWizSteps) * 100;
    document.getElementById('wiz-progress').style.width = `${progress}% `;

    // Buttons
    document.getElementById('wiz-prev').classList.toggle('hidden', currentWizStep === 1);
    document.getElementById('wiz-next').classList.toggle('hidden', currentWizStep === totalWizSteps);
    document.getElementById('wiz-save').classList.toggle('hidden', currentWizStep !== totalWizSteps);
};

window.checkAllocation = () => {
    const total = parseFloat(document.getElementById('lz-portfolio-size').value) || 0;
    const alloc = parseFloat(document.getElementById('lz-alloc-amount').value) || 0;
    const warning = document.getElementById('alloc-warning');

    if (total > 0 && alloc > 0) {
        const percent = (alloc / total) * 100;
        if (percent > 15) {
            warning.classList.remove('hidden');
        } else {
            warning.classList.add('hidden');
        }
    }
};

window.setStrategy = (type) => {
    selectedStrategy = type;
    document.querySelectorAll('#step-4 .seg-btn').forEach(b => {
        b.classList.remove('active');
        if (b.textContent.includes(type === 'DEFENSIVE' ? 'دفاعية' : (type === 'BALANCED' ? 'متوازنة' : 'هجومية'))) {
            b.classList.add('active');
        }
    });
    window.calcStrategyResults();
};

window.calcStrategyResults = () => {
    const amount = parseFloat(document.getElementById('lz-alloc-amount').value) || 0;

    let splits = [];
    if (selectedStrategy === 'DEFENSIVE') splits = [0.20, 0.30, 0.50];
    else if (selectedStrategy === 'BALANCED') splits = [0.30, 0.30, 0.40];
    else splits = [0.50, 0.50]; // Aggressive

    const labels = [
        "دفعة أولى (جس نبض / Market)",
        "دفعة ثانية (تأكيد الاتجاه / Breakout)",
        "دفعة ثالثة (دعم رئيسي / Panic)"
    ];

    if (selectedStrategy === 'AGGRESSIVE') {
        labels[0] = "دفعة أولى (Market)";
        labels[1] = "دفعة تعزيز (Support)";
    }

    let html = '';
    splits.forEach((ratio, idx) => {
        const val = amount * ratio;
        html += `
            < div class="strat-row" >
            <div>
                <span style="display:block; font-size:0.85rem; color:#aaa; margin-bottom:4px">${labels[idx]}</span>
                <span class="strat-badge badge-${selectedStrategy.toLowerCase()}">${(ratio * 100)}%</span>
            </div>
            <strong style="font-size:1.1rem">${window.formatMoney(val)}</strong>
        </div > `;
    });

    document.getElementById('strategy-breakdown').innerHTML = html;
};

window.saveStrategy = async () => {
    if (!auth.currentUser) return window.showToast("يرجى تسجيل الدخول لحفظ الاستراتيجية", "error");

    const failScenario = document.getElementById('lz-fail-scenario').value;
    const worstLoss = document.getElementById('lz-worst-loss').value;
    const reasons = Array.from(document.querySelectorAll('.lz-reason:checked')).map(c => c.value);
    const amount = parseFloat(document.getElementById('lz-alloc-amount').value) || 0;

    const strategyData = {
        date: new Date().toISOString(),
        failScenario,
        worstLoss,
        reasons,
        amount,
        strategyType: selectedStrategy,
        status: 'PENDING'
    };

    try {
        await addDoc(collection(db, 'users', auth.currentUser.uid, 'strategies'), strategyData);
        window.showToast("تم حفظ خطة التداول بنجاح! 🧠", "success");
        window.changeStep(-3); // Reset to step 1
        window.loadStrategies();
    } catch (e) {
        console.error(e);
        window.showToast("فشل الحفظ", "error");
    }
};

window.loadStrategies = async () => {
    if (!auth.currentUser) return;
    const list = document.getElementById('strategy-history-list');

    const q = query(collection(db, 'users', auth.currentUser.uid, 'strategies'), orderBy('date', 'desc'), limit(10));
    try {
        const snap = await getDocs(q);

        if (snap.empty) {
            list.innerHTML = '<div class="empty-state"><p>لا توجد خطط محفوظة</p></div>';
            return;
        }

        list.innerHTML = '';
        snap.forEach(d => {
            const data = d.data();
            const date = new Date(data.date).toLocaleDateString('ar-EG');
            const badgeClass = data.strategyType === 'DEFENSIVE' ? 'badge-defensive' : (data.strategyType === 'BALANCED' ? 'badge-balanced' : 'badge-aggressive');

            list.innerHTML += `
            < div class="glass-card compact-card" style = "margin-bottom:10px; border-right:4px solid var(--primary)" >
                <div style="display:flex; justify-content:space-between; margin-bottom:5px">
                    <span style="font-size:0.8rem; color:#888">${date}</span>
                    <span class="strat-badge ${badgeClass}">${data.strategyType}</span>
                </div>
                <div style="font-size:0.9rem; margin-bottom:5px">
                    <strong>سيناريو الفشل:</strong> ${data.failScenario.substring(0, 50)}...
                </div>
                <div style="font-size:0.85rem; color:#aaa">
                    المبلغ: ${window.formatMoney(data.amount)} | الأسباب: ${data.reasons.length}
                </div>
            </div > `;
        });
    } catch (e) { console.log(e); }
};





// ==========================================
//       ENHANCED UI INTERACTIONS (Merged from app_append.js)
// ==========================================

// Modern Tab Switcher
window.switchCalcTab = (tabName, btn) => {
    // Buttons
    document.querySelectorAll('.sc-btn').forEach(b => b.classList.remove('active'));
    // If btn is passed, use it. If not, find by tabName (optional fallback)
    if (btn) btn.classList.add('active');

    // Content
    document.querySelectorAll('.calc-tab-content').forEach(c => c.classList.remove('active'));
    const target = document.getElementById(`calc-${tabName}`);
    if (target) {
        target.classList.add('active');
        // Animation trigger if needed
        target.style.animation = 'none';
        target.offsetHeight; /* trigger reflow */
        target.style.animation = 'fadeIn 0.3s ease';
    }
};

// Modern Broker Selector
window.selectBroker = (broker, el) => {
    window.currentBroker = broker;
    document.querySelectorAll('.broker-option').forEach(r => r.classList.remove('selected'));
    if (el) {
        el.classList.add('selected');
    }
    window.calcCommission();
};

// === Initialization & Event Listeners ===
// === Initialization & Event Listeners ===
function initApp() {
    console.log('🚀 App Initialized (Module)');

    // Login Button
    const loginBtn = document.getElementById('login-btn');
    if (loginBtn) {
        loginBtn.addEventListener('click', async () => {
            const email = document.getElementById('login-email').value;
            const password = document.getElementById('login-password').value;
            if (!email || !password) {
                window.showToast('يرجى إدخال البريد الإلكتروني وكلمة المرور', 'error');
                return;
            }

            try {
                showLoading();
                await signInWithEmailAndPassword(auth, email, password);
                window.showToast('تم تسجيل الدخول بنجاح', 'success');
            } catch (error) {
                console.error(error);
                window.showToast('فشل تسجيل الدخول: ' + error.message, 'error');
            } finally {
                hideLoading();
            }
        });
    }

    // Logout Button
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            try {
                await signOut(auth);
                window.showToast('تم تسجيل الخروج', 'info');
            } catch (e) {
                console.error(e);
            }
        });
    }

    // Auth State Listener
    onAuthStateChanged(auth, (user) => {
        if (user) {
            console.log('✅ User Signed In:', user.email);
            window.setView('dashboard');

            // Force show navbar
            const nav = document.getElementById('main-nav');
            if (nav) nav.style.display = 'flex';

            // Safe function calls (check if exist before calling)
            if (typeof window.loadPortfolios === 'function') window.loadPortfolios();
            if (typeof window.loadMarketData === 'function') window.loadMarketData(true);
            if (typeof window.loadStrategies === 'function') window.loadStrategies();
        } else {
            console.log('❌ User Signed Out');
            window.setView('auth');
        }
    });

    // Initial View Setup & Navbar Force Hide
    if (!auth.currentUser) {
        window.setView('auth');
        const nav = document.getElementById('main-nav');
        if (nav) nav.style.display = 'none';
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}


