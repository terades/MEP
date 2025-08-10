// production.js

let productionList = [];
let productionFilterText = '';
let productionSortKey = 'startTime';
let productionStatusFilter = 'all';

function showGeneratorView() {
    const gen = document.getElementById('generatorView');
    const prod = document.getElementById('productionView');
    if (gen) gen.style.display = 'block';
    if (prod) prod.style.display = 'none';
}

function showProductionView() {
    const gen = document.getElementById('generatorView');
    const prod = document.getElementById('productionView');
    if (gen) gen.style.display = 'none';
    if (prod) prod.style.display = 'block';
    renderProductionList();
}

function statusKey(status) {
    switch (status) {
        case 'inProgress': return 'In Arbeit';
        case 'done': return 'Abgeschlossen';
        default: return 'Offen';
    }
}

function statusClass(status) {
    switch (status) {
        case 'inProgress': return 'in-progress';
        case 'done': return 'done';
        default: return 'pending';
    }
}

function renderProductionList() {
    const list = document.getElementById('productionList');
    if (!list) return;
    let items = productionList.filter(item => {
        const textMatch = productionFilterText === '' ||
            [item.projekt, item.komm, item.auftrag, item.posnr]
                .some(f => f.toLowerCase().includes(productionFilterText));
        const statusMatch = productionStatusFilter === 'all' || item.status === productionStatusFilter;
        return textMatch && statusMatch;
    });
    items.sort((a, b) => {
        if (productionSortKey === 'projekt') {
            return a.projekt.localeCompare(b.projekt);
        }
        return a.startTime.localeCompare(b.startTime);
    });
    list.innerHTML = '';
    items.forEach((item, index) => {
        const li = document.createElement('li');
        li.className = `production-item ${statusClass(item.status)}`;
        li.innerHTML = `<div><strong>${i18n.t('Startzeit')}:</strong> ${item.startTime}</div>
                        <div><strong>${i18n.t('Projekt')}:</strong> ${item.projekt}</div>
                        <div><strong>Komm:</strong> ${item.komm}</div>
                        <div><strong>${i18n.t('Auftrag')}:</strong> ${item.auftrag}</div>
                        <div><strong>Pos-Nr:</strong> ${item.posnr}</div>
                        <div><strong>${i18n.t('Status')}:</strong> ${i18n.t(statusKey(item.status))}</div>`;
        const img = document.createElement('img');
        img.src = item.labelImg;
        img.style.maxWidth = '200px';
        img.style.marginTop = '0.5rem';
        img.style.cursor = 'pointer';
        img.addEventListener('click', () => window.open(item.labelImg, '_blank'));
        li.appendChild(img);
        const btnGroup = document.createElement('div');
        btnGroup.className = 'button-group';
        if (item.status === 'pending') {
            const startBtn = document.createElement('button');
            startBtn.className = 'btn-secondary';
            startBtn.textContent = i18n.t('Starten');
            startBtn.addEventListener('click', () => {
                item.status = 'inProgress';
                renderProductionList();
            });
            btnGroup.appendChild(startBtn);
        }
        if (item.status === 'inProgress') {
            const doneBtn = document.createElement('button');
            doneBtn.className = 'btn-success';
            doneBtn.textContent = i18n.t('Abschließen');
            doneBtn.addEventListener('click', () => {
                item.status = 'done';
                renderProductionList();
            });
            btnGroup.appendChild(doneBtn);
        }
        li.appendChild(btnGroup);
        list.appendChild(li);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('showGeneratorBtn')?.addEventListener('click', () => showGeneratorView());
    document.getElementById('showProductionBtn')?.addEventListener('click', () => showProductionView());
    document.getElementById('releaseButton')?.addEventListener('click', async () => {
        const startTime = document.getElementById('startzeit')?.value;
        if (!startTime) {
            showFeedback('barcodeError', i18n.t('Bitte Startzeitpunkt angeben.'), 'warning', 3000);
            return;
        }
        const labelElement = document.getElementById('printableLabel');
        const canvas = await html2canvas(labelElement);
        const imgData = canvas.toDataURL('image/png');
        productionList.push({
            startTime,
            projekt: document.getElementById('projekt').value,
            komm: document.getElementById('KommNr').value,
            auftrag: document.getElementById('auftrag').value,
            posnr: document.getElementById('posnr').value,
            labelImg: imgData,
            status: 'pending'
        });
        renderProductionList();
        showProductionView();
    });
    document.getElementById('productionFilter')?.addEventListener('input', e => {
        productionFilterText = e.target.value.toLowerCase();
        renderProductionList();
    });
    document.getElementById('productionSort')?.addEventListener('change', e => {
        productionSortKey = e.target.value;
        renderProductionList();
    });
    document.getElementById('productionStatusFilter')?.addEventListener('change', e => {
        productionStatusFilter = e.target.value;
        renderProductionList();
    });

    document.getElementById('burgerMenu')?.addEventListener('click', () => {
        document.getElementById('navMenu')?.classList.toggle('open');
    });
    document.querySelectorAll('#navMenu button').forEach(btn => {
        btn.addEventListener('click', () => {
            document.getElementById('navMenu')?.classList.remove('open');
        });
    });
    showGeneratorView();
});
