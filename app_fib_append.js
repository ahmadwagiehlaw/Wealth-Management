
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
    if (diff <= 0 && trend === 'UP') return; // Logical check

    // Ratios
    const levels = [
        { r: 0.236, lbl: '23.6%' },
        { r: 0.382, lbl: '38.2%' },
        { r: 0.500, lbl: '50.0%' },
        { r: 0.618, lbl: '61.8% (Golden)' },
        { r: 0.786, lbl: '78.6%' },
        { r: 1.000, lbl: '100% (Full)' },
        { r: 1.618, lbl: '161.8% (Ext)' }
    ];

    let html = '<div class="global-stats-grid" style="grid-template-columns: 1fr 1fr;">';

    levels.forEach(l => {
        let val = 0;
        let typeClass = '';

        if (trend === 'UP') {
            // Retracement down from High
            val = high - (diff * l.r);
            typeClass = 'text-green'; // Buying support
        } else {
            // Retracement up from Low
            val = low + (diff * l.r);
            typeClass = 'text-danger'; // Selling resistance
        }

        // Highlight Golden Ratio
        const isGolden = l.r === 0.618;
        const style = isGolden ? 'background:rgba(255,215,0,0.1); border-color:gold' : '';

        html += `
        <div class="g-stat-box" style="${style}">
            <span class="g-label">${l.lbl}</span>
            <strong class="g-value ${typeClass}" style="font-size:1.1rem">${val.toFixed(2)}</strong>
        </div>`;
    });
    html += '</div>';
    resBox.innerHTML = html;
};

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
        <div style="display:flex; justify-content:space-between; padding:8px; border-bottom:1px solid rgba(255,255,255,0.05)">
            <span style="color:${color}; font-weight:bold">${lbl}</span>
            <span style="font-family:'Inter'; font-weight:bold">${val.toFixed(2)}</span>
        </div>`;

    let html = `<div class="glass-card" style="padding:10px; background:rgba(0,0,0,0.2)">`;

    html += Row('R3', R3, 'var(--danger)');
    html += Row('R2', R2, 'var(--danger)');
    html += Row('R1', R1, 'var(--danger)');

    html += `<div style="text-align:center; padding:10px; background:rgba(255,255,255,0.05); margin:5px 0; border-radius:8px">
                <span style="display:block; font-size:0.7rem; color:#aaa">نقطة الارتكاز (Pivot)</span>
                <strong style="font-size:1.2rem; color: #fff">${P.toFixed(2)}</strong>
             </div>`;

    html += Row('S1', S1, 'var(--success)');
    html += Row('S2', S2, 'var(--success)');
    html += Row('S3', S3, 'var(--success)');

    html += `</div>`;

    resBox.innerHTML = html;
};
