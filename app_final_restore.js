
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
        <div style="display:flex; justify-content:space-between; align-items:center; padding:12px; border-bottom:1px solid rgba(255,255,255,0.05); ${bgStyle}; ${borderStyle}">
            <div style="display:flex; flex-direction:column;">
                <span class="g-label" style="font-size:0.9rem; color:#fff">${l.lbl}</span>
                <span style="font-size:0.7rem; color:#888; margin-top:2px">${desc}</span>
            </div>
            <strong class="g-value ${typeClass}" style="font-size:1.2rem">${val.toFixed(2)}</strong>
        </div>`;
    });
    html += '</div>';
    resBox.innerHTML = html;
};
