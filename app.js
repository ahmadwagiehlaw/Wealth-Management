import { auth, db } from './firebase-config.js';
import { translations } from './translations.js';
import { 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, 
    onAuthStateChanged, 
    signOut 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    collection, addDoc, deleteDoc, doc, onSnapshot, serverTimestamp, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// --- STATE ---
let currentLang = localStorage.getItem('appLang') || 'ar';
let unsubscribe = null;

// --- DOM ELEMENTS ---
const authSection = document.getElementById('auth-section');
const dashboardSection = document.getElementById('dashboard-section');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const userEmailDisplay = document.getElementById('user-email');
const portfolioGrid = document.getElementById('portfolio-grid');
const totalNetWorthEl = document.getElementById('total-net-worth');
const modalOverlay = document.getElementById('modal-overlay');
const createForm = document.getElementById('create-portfolio-form');
const langBtn = document.getElementById('lang-toggle');

// --- INIT ---
applyLanguage(currentLang);

// --- TRANSLATION LOGIC ---
function applyLanguage(lang) {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    
    // Update simple text
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if(translations[lang][key]) el.textContent = translations[lang][key];
    });

    // Update placeholders
    document.querySelectorAll('[data-placeholder]').forEach(el => {
        const key = el.getAttribute('data-placeholder');
        if(translations[lang][key]) el.placeholder = translations[lang][key];
    });

    // Update Toggle Button Text
    langBtn.textContent = translations[lang].toggleLang;
}

langBtn.addEventListener('click', () => {
    currentLang = currentLang === 'ar' ? 'en' : 'ar';
    localStorage.setItem('appLang', currentLang);
    applyLanguage(currentLang);
    // Reload grid to update date formats if needed
    if(auth.currentUser) loadUserPortfolios(auth.currentUser);
});

// --- AUTH HANDLERS ---
onAuthStateChanged(auth, (user) => {
    if (user) {
        authSection.classList.add('hidden');
        dashboardSection.classList.remove('hidden');
        userEmailDisplay.textContent = user.email;
        loadUserPortfolios(user);
        showToast(`${translations[currentLang].welcome}, ${user.email.split('@')[0]}`);
    } else {
        dashboardSection.classList.add('hidden');
        authSection.classList.remove('hidden');
        portfolioGrid.innerHTML = '';
        totalNetWorthEl.textContent = '$0.00';
        if (unsubscribe) unsubscribe();
    }
});

// Register Logic (with detailed Error Handling)
registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;
    
    try {
        await createUserWithEmailAndPassword(auth, email, password);
        // Success is handled by onAuthStateChanged
    } catch (error) {
        console.error("Register Error:", error);
        handleAuthError(error);
    }
});

// Login Logic
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    try {
        await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
        console.error("Login Error:", error);
        handleAuthError(error);
    }
});

document.getElementById('logout-btn').addEventListener('click', () => signOut(auth));

// UI Toggles
document.getElementById('show-register').addEventListener('click', () => {
    loginForm.classList.add('hidden');
    registerForm.classList.remove('hidden');
});
document.getElementById('show-login').addEventListener('click', () => {
    registerForm.classList.add('hidden');
    loginForm.classList.remove('hidden');
});

// --- DATA LOGIC ---
function loadUserPortfolios(user) {
    const q = query(
        collection(db, "users", user.uid, "portfolios"),
        orderBy("createdAt", "desc")
    );

    unsubscribe = onSnapshot(q, (snapshot) => {
        portfolioGrid.innerHTML = "";
        let totalVal = 0;

        if (snapshot.empty) {
            portfolioGrid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: #94a3b8; padding: 50px;">${currentLang === 'ar' ? 'لا توجد محافظ. ابدأ بإنشاء واحدة.' : 'No portfolios found.'}</div>`;
        }

        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            totalVal += parseFloat(data.capital) || 0;
            renderPortfolioCard(docSnap.id, data);
        });

        totalNetWorthEl.textContent = formatMoney(totalVal);
    });
}

function renderPortfolioCard(id, data) {
    const dateStr = data.createdAt ? new Date(data.createdAt.seconds * 1000).toLocaleDateString(currentLang === 'ar' ? 'ar-EG' : 'en-US') : '...';
    
    const card = document.createElement('div');
    card.className = 'glass-panel p-card fade-in';
    card.innerHTML = `
        <div class="p-card-header">
            <div>
                <div class="p-name">${data.name}</div>
                <div class="p-date">${translations[currentLang].created}: ${dateStr}</div>
            </div>
            <button class="delete-btn" onclick="deletePortfolio('${id}')">
                <i class="fa-solid fa-trash"></i>
            </button>
        </div>
        <div class="p-amount">${formatMoney(data.capital)}</div>
    `;
    portfolioGrid.appendChild(card);
}

// Add Portfolio
createForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('p-name').value;
    const capital = parseFloat(document.getElementById('p-capital').value);

    if (auth.currentUser) {
        try {
            await addDoc(collection(db, "users", auth.currentUser.uid, "portfolios"), {
                name: name,
                capital: capital,
                createdAt: serverTimestamp()
            });
            toggleModal();
            createForm.reset();
            showToast(translations[currentLang].toastCreated);
        } catch (err) {
            showToast(translations[currentLang].errorGeneric, true);
        }
    }
});

// Delete Portfolio
window.deletePortfolio = async (id) => {
    if(confirm(translations[currentLang].confirmDelete)) {
        if (auth.currentUser) {
            await deleteDoc(doc(db, "users", auth.currentUser.uid, "portfolios", id));
            showToast(translations[currentLang].toastDeleted);
        }
    }
};

// --- HELPERS ---
function toggleModal() {
    modalOverlay.classList.toggle('hidden');
}
document.getElementById('open-modal-btn').addEventListener('click', toggleModal);
document.getElementById('close-modal-btn').addEventListener('click', toggleModal);
modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) toggleModal(); });

function showToast(msg, isError = false) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.remove('hidden');
    toast.style.borderColor = isError ? '#ef4444' : '#10b981';
    toast.style.color = isError ? '#ef4444' : '#10b981';
    toast.style.backgroundColor = isError ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)';
    setTimeout(() => toast.classList.add('hidden'), 3500);
}

function formatMoney(amount) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function handleAuthError(error) {
    let msg = "حدث خطأ في التسجيل";
    if (error.code === 'auth/email-already-in-use') msg = "البريد الإلكتروني مسجل بالفعل";
    if (error.code === 'auth/invalid-email') msg = "البريد الإلكتروني غير صحيح";
    if (error.code === 'auth/weak-password') msg = "كلمة المرور ضعيفة جداً";
    if (error.code === 'auth/wrong-password') msg = "كلمة المرور غير صحيحة";
    if (error.code === 'auth/user-not-found') msg = "المستخدم غير موجود";
    if (error.code === 'auth/operation-not-allowed') msg = "يجب تفعيل Email/Password في لوحة Firebase!";
    
    showToast(msg, true);
}