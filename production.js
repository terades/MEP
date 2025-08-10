// production.js

let productionList = [];
let productionFilterText = '';
let productionSortKey = 'startTime';
let productionStatusFilter = 'all';
const EDIT_PASSWORD = 'mep';

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

function openReleaseModal() {
    const modal = document.getElementById('releaseModal');
    if (modal) modal.classList.add('visible');
}

function closeReleaseModal() {
    const modal = document.getElementById('releaseModal');
    if (modal) modal.classList.remove('visible');
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

function formatDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
    const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
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
        const duration = item.startTimestamp ? ((item.status === 'done' ? item.endTimestamp : Date.now()) - item.startTimestamp) : null;
        li.innerHTML = `<div><strong>${i18n.t('Startzeit')}:</strong> ${item.startTime}</div>
                        <div><strong>${i18n.t('Projekt')}:</strong> ${item.projekt}</div>
                        <div><strong>Komm:</strong> ${item.komm}</div>
                        <div><strong>${i18n.t('Auftrag')}:</strong> ${item.auftrag}</div>
                        <div><strong>Pos-Nr:</strong> ${item.posnr}</div>
                        <div><strong>${i18n.t('Bemerkung')}:</strong> ${item.note || ''}</div>
                        ${duration !== null ? `<div><strong>${i18n.t('Laufzeit')}:</strong> ${formatDuration(duration)}</div>` : ''}
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
        const editBtn = document.createElement('button');
        editBtn.className = 'btn-secondary';
        editBtn.textContent = i18n.t('Bearbeiten');
        editBtn.addEventListener('click', () => {
            const pwd = prompt(i18n.t('Passwort eingeben'));
            if (pwd !== EDIT_PASSWORD) {
                alert(i18n.t('Falsches Passwort'));
                return;
            }
            const newStart = prompt(i18n.t('Startzeit'), item.startTime);
            if (newStart !== null) item.startTime = newStart;
            const newProjekt = prompt(i18n.t('Projekt'), item.projekt);
            if (newProjekt !== null) item.projekt = newProjekt;
            const newKomm = prompt('Komm', item.komm);
            if (newKomm !== null) item.komm = newKomm;
            const newAuftrag = prompt(i18n.t('Auftrag'), item.auftrag);
            if (newAuftrag !== null) item.auftrag = newAuftrag;
            const newPosnr = prompt('Pos-Nr', item.posnr);
            if (newPosnr !== null) item.posnr = newPosnr;
            const newNote = prompt(i18n.t('Bemerkung'), item.note || '');
            if (newNote !== null) item.note = newNote;
            renderProductionList();
        });
        btnGroup.appendChild(editBtn);
        const noteBtn = document.createElement('button');
        noteBtn.className = 'btn-secondary';
        noteBtn.textContent = i18n.t('Bemerkung');
        noteBtn.addEventListener('click', () => {
            const newNote = prompt(i18n.t('Bemerkung'), item.note || '');
            if (newNote !== null) {
                item.note = newNote;
                renderProductionList();
            }
        });
        btnGroup.appendChild(noteBtn);
        if (item.status === 'pending') {
            const startBtn = document.createElement('button');
            startBtn.className = 'btn-secondary';
            startBtn.textContent = i18n.t('Starten');
            startBtn.addEventListener('click', () => {
                item.status = 'inProgress';
                item.startTimestamp = Date.now();
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
                item.endTimestamp = Date.now();
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
    document.getElementById('releaseButton')?.addEventListener('click', () => {
        const input = document.getElementById('releaseStartzeit');
        if (input) {
            input.value = new Date().toISOString().slice(0,16);
        }
        const note = document.getElementById('releaseNote');
        if (note) note.value = '';
        const err = document.getElementById('releaseModalError');
        if (err) err.textContent = '';
        openReleaseModal();
    });

    document.getElementById('confirmReleaseButton')?.addEventListener('click', async () => {
        const startTime = document.getElementById('releaseStartzeit')?.value;
        if (!startTime) {
            showFeedback('releaseModalError', i18n.t('Bitte Startzeitpunkt angeben.'), 'warning', 3000);
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
            note: document.getElementById('releaseNote')?.value || '',
            labelImg: imgData,
            status: 'pending'
        });
        if (window.deleteCurrentSavedOrder) {
            window.deleteCurrentSavedOrder();
        }
        closeReleaseModal();
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

    const sidebarToggle = document.getElementById('sidebarToggle');
    if (sidebarToggle) {
        sidebarToggle.textContent = document.body.classList.contains('sidebar-open') ? '<' : '>';
        sidebarToggle.addEventListener('click', () => {
            document.body.classList.toggle('sidebar-open');
            sidebarToggle.textContent = document.body.classList.contains('sidebar-open') ? '<' : '>';
        });
    }
    setInterval(() => {
        if (productionList.some(p => p.status === 'inProgress')) {
            renderProductionList();
        }
    }, 1000);
    showGeneratorView();
});
