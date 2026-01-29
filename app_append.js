
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

// Ensure Risk Visualizer Updates on Load/Input
// (Calculated inside calcRR which is triggered by oninput)
