
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
