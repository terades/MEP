			let zonesData = [];
			let templates = [];
			let nextZoneId = 0;
			
			// Visual constants for SVG rendering
			const STIRRUP_HEIGHT_VISUAL = 50;
			const PADDING_VISUAL = 35;
			const DIM_LINE_OFFSET_ABOVE = 30;
			const DIM_LINE_OFFSET_BELOW = 25;
			const INTER_ZONE_DIM_OFFSET = 20;
			const TEXT_ABOVE_LINE_OFFSET = 7;
			const SVG_FONT_FAMILY = "var(--font-family-sans-serif)";
			const SVG_DIM_FONT_SIZE = "14px";
			const SVG_TOTAL_DIM_FONT_SIZE = "15px";
			const SVG_SINGLE_STIRRUP_FONT_SIZE = "13px";
const NUM_ZONE_COLORS_AVAILABLE = 20;
let maxZones = 20; // maximale Anzahl an Zonen, per UI anpassbar
let zonesPerLabel = 16; // Zonenanzahl Zone 1 (aufteilbar)
			
			// Highlight classes
			const HIGHLIGHT_COLOR_CLASS_STROKE = 'highlight-stroke';
			const HIGHLIGHT_COLOR_CLASS_FILL = 'highlight-fill';
			const HIGHLIGHT_BG_FILL_CLASS = 'highlight-bg-fill';
			
			let previewUpdateTimer;
let highlightedZoneDisplayIndex = null;
let dimensioningMode = 'arrangementLength'; // 'arrangementLength' or 'totalZoneSpace'
let showOverhangs = false;
			
			// Local storage key for templates
const LOCAL_STORAGE_TEMPLATES_KEY = 'bvbsKorbsTemplates';
const LOCAL_STORAGE_LABEL_LAYOUT_KEY = 'labelLayoutConfig';
const LABEL_ELEMENT_IDS = ['descPosnr','labelPosnr','labelKommNr','labelBuegelname','descProjekt','labelProjekt','descAuftrag','labelAuftrag','descLange','labelGesamtlange'];
let labelLayout = {};
let labelDesignMode = false;
			
			// Helper function to show/hide feedback messages
			function showFeedback(elementId, message, type = 'info', duration = 3000) {
			    const element = document.getElementById(elementId);
			    if (!element) return;
			    element.textContent = message;
			    element.className = `info-text ${type}-message`;
			    clearTimeout(element.timer);
			    element.timer = setTimeout(() => {
			        element.textContent = '';
			        element.className = 'info-text';
			    }, duration);
			}
			
			// Helper function for input-specific feedback
                        function showInputFeedback(inputElement, message, type = 'info', duration = 3000) {
			    let feedbackElement = inputElement.nextElementSibling;
			    if (!feedbackElement || !feedbackElement.classList.contains('input-feedback')) {
			        feedbackElement = document.createElement('span');
			        feedbackElement.classList.add('input-feedback');
			        inputElement.parentNode.insertBefore(feedbackElement, inputElement.nextSibling);
			    }
			    feedbackElement.textContent = message;
			    feedbackElement.classList.remove('error-message', 'warning-message', 'success-message');
			    if (message) {
			        feedbackElement.classList.add(`${type}-message`);
			        feedbackElement.style.height = 'auto';
			        feedbackElement.style.opacity = '1';
			    } else {
			        feedbackElement.style.height = '0';
			        feedbackElement.style.opacity = '0';
			        feedbackElement.classList.remove('error-message', 'warning-message', 'success-message');
			    }
			    clearTimeout(inputElement.feedbackTimer);
			    inputElement.feedbackTimer = setTimeout(() => {
			        feedbackElement.textContent = '';
			        feedbackElement.style.height = '0';
			        feedbackElement.style.opacity = '0';
			        feedbackElement.classList.remove('error-message', 'warning-message', 'success-message');
			    }, duration);
			}
			
			// Updates the debug info log
			function updateBarcodeDebugInfo(message) {
			    const debugInfoEl = document.getElementById('barcodeDebugInfo');
			    if (debugInfoEl) {
			        const timestamp = new Date().toLocaleTimeString();
			        debugInfoEl.textContent += `[${timestamp}] ${message}\n`;
			        debugInfoEl.scrollTop = debugInfoEl.scrollHeight; // Scroll to bottom
			    }
			    console.log(`[Barcode Debug] ${message}`);
			}
			
                        function getBvbsCodes() {
                            const code1 = document.getElementById('outputBvbsCode1')?.value.trim();
                            const code2 = document.getElementById('outputBvbsCode2')?.value.trim();
                            return [code1, code2].filter(code => code && code.startsWith('BF2'));
                        }

                        // Updates the barcode status text
                        function updateBarcodeStatus() {
                            const statusEl = document.getElementById('barcodeStatus');
                            const barcodeContainer = document.getElementById('barcodeSvgContainer');
                            const bvbsCodes = getBvbsCodes();
                            if (!statusEl) return;
                            if (barcodeContainer && barcodeContainer.querySelector('svg') && !barcodeContainer.classList.contains('hidden')) {
                                statusEl.textContent = 'Barcode generiert';
                                statusEl.style.color = 'var(--success-color)';
                            } else if (bvbsCodes.length > 0) {
                                statusEl.textContent = 'Code generiert, Barcode fehlt';
                                statusEl.style.color = 'var(--warning-color)';
                            } else {
                                statusEl.textContent = 'Bereit zur Generierung';
                                statusEl.style.color = 'var(--text-muted-color)';
                            }
                        }
			
			// Checks if the barcode library is loaded
function checkBarcodeLibraryStatus() {
                            if (typeof bwipjs === 'undefined') {
                                console.warn("bwip-js library not available");
                                updateBarcodeDebugInfo("bwip-js Bibliothek nicht verfügbar");
                                return false;
                            }
                            console.log("bwip-js library loaded successfully");
                            updateBarcodeDebugInfo("bwip-js Bibliothek erfolgreich geladen");
                            return true;
}

function updateGenerateButtonState() {
    const generateBtn = document.getElementById('generateButton');
    const buegelname2El = document.getElementById('buegelname2');
    const errorEl = document.getElementById('generateError');
    if (!generateBtn || !buegelname2El) return;
    const needSecond = zonesData.length > zonesPerLabel;
    const hasName = buegelname2El.value.trim().length > 0;
    if (needSecond && !hasName) {
        generateBtn.disabled = true;
        if (errorEl) {
            errorEl.textContent = 'Fehler: Bügelname (s) - Zone 2 ist erforderlich.';
            errorEl.className = 'info-text error-message';
        }
    } else {
        generateBtn.disabled = false;
        if (errorEl) {
            errorEl.textContent = '';
            errorEl.className = 'info-text';
        }
    }
}

function loadLabelLayout() {
                            const data = localStorage.getItem(LOCAL_STORAGE_LABEL_LAYOUT_KEY);
                            if (data) {
                                try { labelLayout = JSON.parse(data); } catch(e) { labelLayout = {}; }
                            }
                            LABEL_ELEMENT_IDS.forEach(id => {
                                const el = document.getElementById(id);
                                if (el && !labelLayout[id]) {
                                    const fs = parseFloat(window.getComputedStyle(el).fontSize) || 12;
                                    labelLayout[id] = { dx: 0, dy: 0, fontSize: fs };
                                }
                            });
                        }

                        function saveLabelLayout() {
                            localStorage.setItem(LOCAL_STORAGE_LABEL_LAYOUT_KEY, JSON.stringify(labelLayout));
                        }

                        function applyLabelLayout() {
                            LABEL_ELEMENT_IDS.forEach(id => {
                                const el = document.getElementById(id);
                                const layout = labelLayout[id];
                                if (el && layout) {
                                    el.style.transform = `translate(${layout.dx}px, ${layout.dy}px)`;
                                    el.style.fontSize = layout.fontSize + 'pt';
                                }
                                const el2 = document.getElementById(id + '2');
                                if (el2 && layout) {
                                    el2.style.transform = `translate(${layout.dx}px, ${layout.dy}px)`;
                                    el2.style.fontSize = layout.fontSize + 'pt';
                                }
                            });
                        }

                        function makeElementDraggable(el) {
                            let startX, startY, origX, origY;
                            const id = el.id.replace('2','');
                            el.addEventListener('mousedown', (e) => {
                                if (!labelDesignMode) return;
                                startX = e.clientX; startY = e.clientY;
                                const layout = labelLayout[id] || { dx:0, dy:0, fontSize: parseFloat(getComputedStyle(el).fontSize) || 12 };
                                origX = layout.dx; origY = layout.dy;
                                const onMove = (ev) => {
                                    const dx = ev.clientX - startX;
                                    const dy = ev.clientY - startY;
                                    const newX = origX + dx;
                                    const newY = origY + dy;
                                    el.style.transform = `translate(${newX}px, ${newY}px)`;
                                    if (labelLayout[id]) { labelLayout[id].dx = newX; labelLayout[id].dy = newY; }
                                    const el2 = document.getElementById(id + '2');
                                    if (el2) el2.style.transform = `translate(${newX}px, ${newY}px)`;
                                };
                                const onUp = () => {
                                    document.removeEventListener('mousemove', onMove);
                                    document.removeEventListener('mouseup', onUp);
                                    saveLabelLayout();
                                };
                                document.addEventListener('mousemove', onMove);
                                document.addEventListener('mouseup', onUp);
                                e.preventDefault();
                            });
                            el.addEventListener('dblclick', () => {
                                if (!labelDesignMode) return;
                                const current = labelLayout[id]?.fontSize || parseFloat(getComputedStyle(el).fontSize) || 12;
                                const input = prompt('Schriftgröße (pt)', current);
                                if (input) {
                                    const fs = parseFloat(input);
                                    if (!isNaN(fs)) {
                                        labelLayout[id].fontSize = fs;
                                        el.style.fontSize = fs + 'pt';
                                        const el2 = document.getElementById(id + '2');
                                        if (el2) el2.style.fontSize = fs + 'pt';
                                        saveLabelLayout();
                                    }
                                }
                            });
                        }

                        function toggleLabelDesignMode() {
                            labelDesignMode = !labelDesignMode;
                            const labels = [document.getElementById('printableLabel'), document.getElementById('printableLabel2')];
                            labels.forEach(l => { if (l) l.classList.toggle('label-edit-mode', labelDesignMode); });
                            LABEL_ELEMENT_IDS.forEach(id => {
                                const el = document.getElementById(id);
                                const el2 = document.getElementById(id + '2');
                                [el, el2].forEach(item => { if (item) item.classList.toggle('label-edit-item', labelDesignMode); });
                            });
                            if (!labelDesignMode) saveLabelLayout();
                        }
			
			// Load templates from localStorage or default file
			async function loadTemplatesFromFile() {
			    try {
			        const storedTemplates = localStorage.getItem(LOCAL_STORAGE_TEMPLATES_KEY);
			        if (storedTemplates) {
			            templates = JSON.parse(storedTemplates);
			            populateTemplateDropdown();
			            console.log("Templates aus localStorage geladen.");
			            renderAllZones();
			            return;
			        }
			        const response = await fetch('lagen.json');
			        if (!response.ok) {
			            if (response.status === 404) {
			                console.warn("lagen.json nicht gefunden oder leer, starte mit leeren Templates.");
                                        templates = [];
                                        populateTemplateDropdown();
                                        renderAllZones();
                                        return;
			            }
			            throw new Error(`HTTP error! status: ${response.status}`);
			        }
			        const data = await response.json();
			        templates = data;
			        populateTemplateDropdown();
			        console.log("Templates aus lagen.json geladen.");
			        saveTemplatesToLocalStorage();
			        renderAllZones();
			    } catch (e) {
			        console.error("Konnte Templates nicht laden:", e);
			        showFeedback('templateFeedback', "Fehler: Templates konnten nicht geladen werden.", 'error', 5000);
                                templates = [];
                                populateTemplateDropdown();
                                renderAllZones();
                            }
                        }
			
			// Save templates to localStorage
			function saveTemplatesToLocalStorage() {
			    try {
			        localStorage.setItem(LOCAL_STORAGE_TEMPLATES_KEY, JSON.stringify(templates));
			        console.log("Templates im localStorage gespeichert.");
			    } catch (e) {
			        console.error("Fehler beim Speichern der Templates in localStorage:", e);
			        showFeedback('templateFeedback', "Fehler: Templates konnten nicht lokal gespeichert werden.", 'error', 5000);
			    }
			}
			
			// Populate the template dropdown menu
			function populateTemplateDropdown() {
			    const dropdown = document.getElementById('templateSelect');
			    if (!dropdown) return;
			    dropdown.innerHTML = '<option value="">Template auswählen…</option>';
			    templates.forEach(template => {
			        const option = document.createElement('option');
			        option.value = template.name;
			        option.textContent = template.name;
			        dropdown.appendChild(option);
			    });
			}
			
			// Apply a selected template
			function applyTemplate(templateName) {
			    if (!templateName) {
			        zonesData = [];
			        nextZoneId = 0;
			        renderAllZones();
			        showFeedback('templateFeedback', `Aktuelle Zonen geleert.`, 'info');
			        return;
			    }
			    const template = templates.find(t => t.name === templateName);
			    if (template && template.zones) {
			        zonesData = JSON.parse(JSON.stringify(template.zones)); // Deep copy to prevent reference issues
			        nextZoneId = zonesData.length > 0 ? Math.max(...zonesData.map(z => z.id)) + 1 : 0;
			        renderAllZones();
			        showFeedback('templateFeedback', `Template "${templateName}" geladen.`, 'success');
			    } else {
			        showFeedback('templateFeedback', `Template "${templateName}" nicht gefunden.`, 'error');
			    }
			}
			
			// Save the current zones as a new template
			function saveCurrentTemplate() {
			    const templateNameInput = document.getElementById('templateName');
			    const feedbackEl = document.getElementById('templateFeedback');
			    const templateName = templateNameInput.value.trim();
			    feedbackEl.textContent = '';
			    if (!templateName) {
			        showFeedback('templateFeedback', "Bitte einen Template-Namen eingeben.", 'warning');
			        return;
			    }
			    if (zonesData.length === 0) {
			        showFeedback('templateFeedback', "Es sind keine Zonen zum Speichern vorhanden.", 'warning');
			        return;
			    }
			    const existingIndex = templates.findIndex(t => t.name === templateName);
			    const newTemplate = {
			        name: templateName,
			        zones: JSON.parse(JSON.stringify(zonesData))
			    };
			    if (existingIndex > -1) {
			        templates[existingIndex] = newTemplate;
			        showFeedback('templateFeedback', `Template "${templateName}" aktualisiert.`, 'success');
			    } else {
			        templates.push(newTemplate);
			        showFeedback('templateFeedback', `Template "${templateName}" gespeichert.`, 'success');
			    }
			    populateTemplateDropdown();
			    document.getElementById('templateSelect').value = templateName;
			    templateNameInput.value = '';
			    saveTemplatesToLocalStorage();
			}
			
			// Delete a template by its name
			function deleteTemplateById(templateName) {
			    if (confirm(`Soll das Template "${templateName}" wirklich gelöscht werden?`)) {
			        templates = templates.filter(t => t.name !== templateName);
			        saveTemplatesToLocalStorage();
			        populateTemplateDropdown();
			        renderTemplateListInModal();
			        if (document.getElementById('templateSelect').value === templateName) {
			            document.getElementById('templateSelect').value = "";
			            applyTemplate("");
			        }
			        showFeedback('templateFeedback', `Template "${templateName}" gelöscht.`, 'success');
			    }
			}
			
			// Delete all templates from modal
			function deleteAllTemplatesFromModal() {
			    if (confirm("Sind Sie sicher, dass Sie ALLE gespeicherten Templates löschen möchten? Dies kann nicht rückgängig gemacht werden!")) {
			        templates = [];
			        saveTemplatesToLocalStorage();
			        populateTemplateDropdown();
			        document.getElementById('templateSelect').value = "";
			        applyTemplate("");
			        renderTemplateListInModal();
			        showFeedback('templateFeedback', "Alle Templates gelöscht.", 'success');
			    }
			}
			
                        // Download templates as a JSON file
                        function downloadTemplatesAsJson() {
                            const json = JSON.stringify(templates, null, 2);
                            const blob = new Blob([json], {
                                type: 'application/json'
                            });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = 'lagen.json';
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                            URL.revokeObjectURL(url);
                            showFeedback('templateFeedback', i18n.t('lagen.json heruntergeladen! Bitte manuell in den Projektordner verschieben.'), 'info', 5000);
                          }

                          // Download a label as PNG using html2canvas
                          function downloadLabelAsPng(labelId) {
                              const label = document.getElementById(labelId);
                              if (!label) return;
                              html2canvas(label).then(canvas => {
                                  const link = document.createElement('a');
                                  link.href = canvas.toDataURL('image/png');
                                  link.download = labelId + '.png';
                                  link.click();
                              });
                          }

                          // Trigger the hidden file input for importing templates
                          function uploadTemplatesFromJson() {
                            const input = document.getElementById('templateFileInput');
                            if (input) {
                                input.value = '';
                                input.click();
                            }
                        }

                        // Handle uploaded template JSON
                        function handleTemplateFileImport(event) {
                            const file = event.target.files[0];
                            if (!file) return;
                            const reader = new FileReader();
                            reader.onload = (e) => {
                                try {
                                    const data = JSON.parse(e.target.result);
                                    if (Array.isArray(data)) {
                                        templates = data;
                                        saveTemplatesToLocalStorage();
                                        populateTemplateDropdown();
                                        renderTemplateListInModal();
                                        showFeedback('templateFeedback', i18n.t('Templates importiert.'), 'success');
                                    } else {
                                        throw new Error('Invalid format');
                                    }
                                } catch (err) {
                                    console.error(i18n.t('Fehler beim Import der Templates:'), err);
                                    showFeedback('templateFeedback', i18n.t('Fehler: Ungültige Template-Datei.'), 'error', 5000);
                                }
                            };
                            reader.readAsText(file);
                        }
			
			// Open the template management modal
			function openTemplateManagerModal() {
			    const modal = document.getElementById('templateManagerModal');
			    modal.classList.add('visible');
			    renderTemplateListInModal();
			}
			
			// Close the template management modal
                        function closeTemplateManagerModal() {
                            const modal = document.getElementById('templateManagerModal');
                            modal.classList.remove('visible');
                        }

                        function openZplModal() {
                            const modal = document.getElementById('zplModal');
                            const content = document.getElementById('zplCodeContent');
                            if (modal && content) {
                                const zpl1 = generateZplForLabel('');
                                const secondLabelVisible = zonesData.length > zonesPerLabel;
                                const zpl2 = secondLabelVisible ? '\n\n' + generateZplForLabel('2') : '';
                                content.textContent = zpl1 + zpl2;
                                modal.classList.add('visible');
                            }
                        }

                        function closeZplModal() {
                            const modal = document.getElementById('zplModal');
                            if (modal) modal.classList.remove('visible');
                        }
			
			// Generate a compact summary of zones for the template manager
			function generateZoneSummary(zones) {
			    if (!zones || zones.length === 0) {
			        return "Keine Zonen definiert.";
			    }
			    const summary = zones.map(zone => {
			        if (zone.num === 1) {
			            return `Ø${zone.dia}(1x)`;
			        } else if (zone.num > 1) {
			            return `Ø${zone.dia}(${zone.num}x${zone.pitch})`;
			        } else {
			            return `Ø${zone.dia}(0x)`;
			        }
			    });
			    return `${zones.length} Zone(n): ${summary.join(', ')}`;
			}
			
			// Render the list of templates in the modal
			function renderTemplateListInModal() {
			    const tbody = document.querySelector('#templateListTable tbody');
			    tbody.innerHTML = '';
			    if (templates.length === 0) {
			        const row = tbody.insertRow();
			        const cell = row.insertCell();
			        cell.colSpan = 3;
			        cell.textContent = "Keine Templates gespeichert.";
			        cell.style.textAlign = "center";
			        cell.style.fontStyle = "italic";
			        cell.style.padding = "1rem";
			        return;
			    }
			    templates.forEach(template => {
			        const row = tbody.insertRow();
			        row.dataset.templateName = template.name;
			        const nameCell = row.insertCell();
			        nameCell.classList.add('template-name-cell');
			        nameCell.textContent = template.name;
			        nameCell.setAttribute('data-label', 'Name');
			        nameCell.ondblclick = () => makeTemplateNameEditable(nameCell, template);
			        const zonesCell = row.insertCell();
			        zonesCell.textContent = generateZoneSummary(template.zones);
			        zonesCell.setAttribute('data-label', 'Zonenübersicht');
			        const actionsCell = row.insertCell();
			        actionsCell.style.textAlign = "center";
			        actionsCell.setAttribute('data-label', 'Aktionen');
			        actionsCell.innerHTML = `
			            <button type="button" class="btn-secondary btn-delete-template" title="Template löschen" onclick="deleteTemplateById('${template.name.replace(/'/g, "\\'")}')">
			                <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zm2.46-7.12l1.41-1.41L12 12.59l2.12-2.12l1.41 1.41L13.41 14l2.12 2.12l-1.41 1.41L12 15.41l-2.12 2.12l-1.41-1.41L10.59 14l-2.13-2.12zM15.5 4l-1-1h-5l-1 1H5v2h14V4z"/></svg>
			            </button>
			        `;
			    });
			}
			
			// Make a template name editable on double-click
			function makeTemplateNameEditable(cell, template) {
			    if (cell.querySelector('input')) return;
			    const originalName = template.name;
			    const input = document.createElement('input');
			    input.type = 'text';
			    input.value = originalName;
			    input.classList.add('form-control');
			    cell.textContent = '';
			    cell.appendChild(input);
			    input.focus();
			
			    const saveChange = () => {
			        const newName = input.value.trim();
			        if (newName === originalName) {
			            cell.textContent = originalName;
			            return;
			        }
			        if (newName === "") {
			            showFeedback('templateFeedback', "Template-Name darf nicht leer sein.", 'error');
			            cell.textContent = originalName;
			            return;
			        }
			        if (templates.some(t => t.name === newName && t.name !== originalName)) {
			            showFeedback('templateFeedback', `Template "${newName}" existiert bereits.`, 'error');
			            cell.textContent = originalName;
			            return;
			        }
			
			        const index = templates.findIndex(t => t.name === originalName);
			        if (index !== -1) {
			            templates[index].name = newName;
			            saveTemplatesToLocalStorage();
			            populateTemplateDropdown();
			            renderTemplateListInModal();
			            showFeedback('templateFeedback', `Template umbenannt zu "${newName}".`, 'success');
			        }
			    };
			
			    input.addEventListener('blur', saveChange);
			    input.addEventListener('keypress', (e) => {
			        if (e.key === 'Enter') {
			            input.blur();
			        }
			    });
			}
			
			// Validate a number input field
			function validateNumberInput(inputElement, min = 0, type = 'float', infoText = '') {
			    const value = type === 'int' ? parseInt(inputElement.value, 10) : parseFloat(inputElement.value);
			    const labelText = inputElement.previousElementSibling ? inputElement.previousElementSibling.textContent.replace(':', '').trim() : inputElement.id;
			
			    if (isNaN(value)) {
			        showInputFeedback(inputElement, `${labelText} muss eine Zahl sein.`, 'error');
			        inputElement.classList.add('input-error');
			        return false;
			    }
			    if (value < min) {
			        showInputFeedback(inputElement, `${labelText} muss mindestens ${min} sein.`, 'error');
			        inputElement.classList.add('input-error');
			        return false;
			    }
			
			    if (infoText) {
			        showInputFeedback(inputElement, infoText, 'info', 2000);
			    } else {
			        showInputFeedback(inputElement, '');
			    }
			    inputElement.classList.remove('input-error');
			    return true;
			}
			
			// Toggle the dimensioning mode for the SVG preview
                        function toggleDimensioningMode(mode) {
                            dimensioningMode = mode;
                            drawCagePreview();
                        }

                        // Toggle visibility of overhangs in the SVG preview
                        function toggleOverhangVisibility(show) {
                            showOverhangs = show;
                            drawCagePreview();
                        }
			
			// Initialize collapsible sections
			function initCollapsibleHeaders() {
			document.querySelectorAll('.collapsible-header').forEach(header => {
			const content = header.nextElementSibling;
			// entferne das automatische Einklappen:
			// content.classList.remove('collapsed');
			// header.classList.remove('collapsed');
			header.addEventListener('click', () => {
			content.classList.toggle('collapsed');
			header.classList.toggle('collapsed');
			});
			});
			}
			
			
			// Set the currently highlighted zone
			function setHighlightedZone(displayIndex, isHighlighted) {
			    const allRows = document.querySelectorAll('.focused-zone-form');
			    allRows.forEach(row => row.classList.remove('focused-zone-form'));
			    highlightedZoneDisplayIndex = isHighlighted ? displayIndex : null;
			    if (isHighlighted && displayIndex !== null) {
			        const tableRow = document.querySelector(`#zonesTable tbody tr:nth-child(${displayIndex})`);
			        if (tableRow) {
			            tableRow.classList.add('focused-zone-form');
			        }
			        const summaryCells = document.querySelectorAll('#zoneSummaryTable tbody tr');
			        summaryCells.forEach(row => {
			            const cells = row.querySelectorAll('td');
			            if (cells[displayIndex]) {
			                cells[displayIndex].classList.add('focused-zone-form');
			            }
			        });
			    }
			    triggerPreviewUpdateDebounced();
			}
			
			// Render all zone input fields and buttons AND the summary table
			function renderAllZones() {
			    const tbody = document.querySelector('#zonesTable tbody');
			    if (!tbody) return;
			    tbody.innerHTML = '';
			    if (zonesData.length === 0) {
			        const emptyRow = tbody.insertRow();
			        const cell = emptyRow.insertCell();
			        cell.colSpan = 5;
			        cell.textContent = "Noch keine Zonen definiert. Fügen Sie eine hinzu!";
			        cell.style.textAlign = "center";
			        cell.style.fontStyle = "italic";
			        cell.style.padding = "1rem";
			        tbody.appendChild(emptyRow);
			        renderZoneSummaryTable(); // Now calling the correct function
			        triggerPreviewUpdateDebounced();
			        return;
			    }
			
			    zonesData.forEach((zone, index) => {
			        const displayIndex = index + 1;
                                const row = tbody.insertRow();
                                row.dataset.zoneId = zone.id;
                                row.classList.add('zone-item');
                                if (index < zonesPerLabel) {
                                    row.classList.add('first-label-zone');
                                }
                                if (highlightedZoneDisplayIndex === displayIndex) {
                                    row.classList.add('focused-zone-form');
                                }
			
			        const zoneCell = row.insertCell();
			        zoneCell.textContent = displayIndex;
			        zoneCell.setAttribute('data-label', 'Zone');
			        zoneCell.style.fontWeight = 'bold';
			        zoneCell.style.textAlign = 'center';
			
			        // Add mouse events for highlighting on hover
			        row.addEventListener('mouseover', () => setHighlightedZone(displayIndex, true));
			        row.addEventListener('mouseout', () => setHighlightedZone(displayIndex, false));
			
			        const diaCell = row.insertCell();
			        diaCell.setAttribute('data-label', 'Ø (d)');
			        diaCell.innerHTML = `
			            <div class="form-group">
			                <label for="durchmesser-${zone.id}">Ø (d):</label>
			                <select id="durchmesser-${zone.id}" oninput="updateZoneData(${zone.id}, 'dia', this.value); validateNumberInput(this, 6, 'int', 'Mind. 6mm');" onfocus="setHighlightedZone(${displayIndex},true)" onblur="setHighlightedZone(${displayIndex},false)">
			                    <option value="6" ${zone.dia == 6 ? 'selected' : ''}>6 mm</option>
			                    <option value="8" ${zone.dia == 8 ? 'selected' : ''}>8 mm</option>
			                    <option value="10" ${zone.dia == 10 ? 'selected' : ''}>10 mm</option>
			                    <option value="12" ${zone.dia == 12 ? 'selected' : ''}>12 mm</option>
			                    <option value="14" ${zone.dia == 14 ? 'selected' : ''}>14 mm</option>
			                    <option value="16" ${zone.dia == 16 ? 'selected' : ''}>16 mm</option>
			                </select>
			                <span class="input-feedback"></span>
			            </div>
			        `;
			
			        const numCell = row.insertCell();
			        numCell.setAttribute('data-label', 'Anzahl (n)');
			        numCell.innerHTML = `
			            <div class="form-group">
			                <label for="anzahlBUEGEL-${zone.id}">Anzahl (n):</label>
			                <input type="number" id="anzahlBUEGEL-${zone.id}" value="${zone.num}" min="0" oninput="updateZoneData(${zone.id}, 'num', this.value); validateNumberInput(this, 0, 'int', 'Anzahl >= 0');" onfocus="setHighlightedZone(${displayIndex},true)" onblur="setHighlightedZone(${displayIndex},false)">
			                <span class="input-feedback"></span>
			            </div>
			        `;
			
			        const pitchCell = row.insertCell();
                                pitchCell.setAttribute('data-label', 'Pitch (p)');
                                pitchCell.innerHTML = `
                                    <div class="form-group">
                                        <label for="pitch-${zone.id}">Pitch (p):</label>
                                        <input type="number" id="pitch-${zone.id}" value="${zone.pitch}" min="1" oninput="updateZoneData(${zone.id}, 'pitch', this.value); validateNumberInput(this, 1, 'int', 'Pitch >= 1mm');" onfocus="setHighlightedZone(${displayIndex},true)" onblur="setHighlightedZone(${displayIndex},false)">
                                        <span class="input-feedback"></span>
                                    </div>
                                `;
                                const pitchInput = pitchCell.querySelector('input');
                                if (pitchInput) {
                                    pitchInput.addEventListener('keydown', (e) => {
                                        if (e.key === 'Tab' && !e.shiftKey && index === zonesData.length - 1) {
                                            e.preventDefault();
                                            addZone(8, 3, 150, true);
                                        }
                                    });
                                }
			
			        const actionsCell = row.insertCell();
			        actionsCell.setAttribute('data-label', 'Aktion');
			        actionsCell.style.textAlign = 'center';
			        actionsCell.innerHTML = `
			            <button type="button" class="btn-delete-zone" onclick="removeSpecificZoneById(${zone.id})" title="Diese Zone löschen">
			                <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zm2.46-7.12l1.41-1.41L12 12.59l2.12-2.12l1.41 1.41L13.41 14l2.12 2.12l-1.41 1.41L12 15.41l-2.12 2.12l-1.41-1.41L10.59 14l-2.13-2.12zM15.5 4l-1-1h-5l-1 1H5v2h14V4z"/></svg>
			            </button>
			        `;
			    });
			    renderZoneSummaryTable();
			    triggerPreviewUpdateDebounced();
			}
			
			// Update a specific zone's data
			function updateZoneData(zoneId, field, value) {
			    const zone = zonesData.find(z => z.id == zoneId);
			    if (zone) {
			        let parsedValue;
			        if (field === 'num') {
			            parsedValue = parseInt(value, 10);
			            zone[field] = Number.isInteger(parsedValue) && parsedValue >= 0 ? parsedValue : zone[field] || 0;
			        } else {
			            parsedValue = parseFloat(value);
			            zone[field] = parsedValue > 0 ? parsedValue : zone[field] || (field === 'dia' ? 8 : 1);
			        }
			    }
			    triggerPreviewUpdateDebounced();
			    renderZoneSummaryTable(); // This is the corrected call
			}
			
			// Add a new zone to the list
                        function addZone(dia = 8, num = 3, pitch = 150, focusNum = false) {
                            if (zonesData.length >= maxZones) {
                                showFeedback('templateFeedback', 'Maximale Zonenanzahl erreicht.', 'warning', 3000);
                                return;
                            }
                            const newId = nextZoneId++;
                            zonesData.push({
                                id: newId,
                                dia: dia,
                                num: num,
                                pitch: pitch
                            });
                            renderAllZones();
                            updateAddZoneButtonState();
                            if (focusNum) {
                                const numInput = document.getElementById(`anzahlBUEGEL-${newId}`);
                                if (numInput) {
                                    numInput.focus();
                                }
                            }

                            // Scroll to the new zone and briefly highlight it
                            setTimeout(() => {
                                const newRow = document.querySelector(`#zonesTable tr[data-zone-id="${newId}"]`);
                                if (newRow) {
                                    const tableWrapper = newRow.closest('.zone-table-wrapper');
                                    if (tableWrapper) {
                                        const wrapperRect = tableWrapper.getBoundingClientRect();
                                        const rowRect = newRow.getBoundingClientRect();
			                const isVisible = rowRect.top >= wrapperRect.top && rowRect.bottom <= wrapperRect.bottom;
			                if (!isVisible) {
			                    newRow.scrollIntoView({
			                        behavior: 'smooth',
			                        block: 'nearest'
			                    });
			                }
			            } else {
			                newRow.scrollIntoView({
			                    behavior: 'smooth',
			                    block: 'nearest'
			                });
			            }
			            newRow.style.transition = 'background-color .3s ease-in-out';
			            newRow.style.backgroundColor = 'rgba(var(--primary-color-rgb), .1)';
			            setTimeout(() => {
			                newRow.style.backgroundColor = '';
			            }, 1500);
			        }
			    }, 100);
			}
			
			// Remove a specific zone by ID
                        function removeSpecificZoneById(zoneId) {
                            zonesData = zonesData.filter(zone => zone.id != zoneId);
                            // Adjust highlighted zone if it was deleted
                            if (highlightedZoneDisplayIndex && (zonesData.length < highlightedZoneDisplayIndex || !zonesData.find((z, i) => i + 1 === highlightedZoneDisplayIndex))) {
                                setHighlightedZone(null, false);
			    } else if (zonesData.length === 0) {
			        setHighlightedZone(null, false);
                            }
                            renderAllZones();
                            updateAddZoneButtonState();
                            showFeedback('templateFeedback', 'Zone gelöscht.', 'success', 2000);
                        }

                        function updateAddZoneButtonState() {
                            const btn = document.getElementById('addZoneButton');
                            if (btn) btn.disabled = zonesData.length >= maxZones;
                        }

function updateMaxZones(value) {
    const parsed = parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed >= 1) {
        maxZones = parsed;
    }
    updateAddZoneButtonState();
}

function updateZonesPerLabel(value) {
    const parsed = parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed >= 1) {
        zonesPerLabel = parsed;
    }
    renderAllZones();
    updateLabelPreview();
}



                        // Debounce function to prevent excessive updates while typing
                        function triggerPreviewUpdateDebounced() {
			    clearTimeout(previewUpdateTimer);
			    previewUpdateTimer = setTimeout(drawCagePreview, 150);
			}
			
			// Render the summary table of zones
                        function renderZoneSummaryTable() {
                            const tbody = document.querySelector("#zoneSummaryTable tbody");
                            if (!tbody) return;

                            tbody.innerHTML = ''; // Clear old content

                            if (zonesData.length === 0) {
                                const emptyRow = document.createElement('tr');
                                const emptyCell = document.createElement('td');
                                emptyCell.textContent = "Keine Zonen definiert.";
                                emptyCell.colSpan = 2; // Span across two columns
                                emptyRow.appendChild(emptyCell);
                                tbody.appendChild(emptyRow);
                                return;
                            }

                            const headerLabels = ["Zone", "Anzahl (n)", "Abstand (p)"];
                            const firstGroup = zonesData.slice(0, zonesPerLabel);
                            const secondGroup = zonesData.slice(zonesPerLabel);

                            if (secondGroup.length > 0) {
                                const groupRow = document.createElement('tr');
                                const emptyTh = document.createElement('th');
                                groupRow.appendChild(emptyTh);
                                const g1 = document.createElement('th');
                                g1.textContent = 'Code 1';
                                g1.colSpan = firstGroup.length;
                                groupRow.appendChild(g1);
                                const g2 = document.createElement('th');
                                g2.textContent = 'Code 2';
                                g2.colSpan = secondGroup.length;
                                groupRow.appendChild(g2);
                                tbody.appendChild(groupRow);
                            }

                            headerLabels.forEach((label, colIndex) => {
                                const row = document.createElement('tr');
                                const headerCell = document.createElement('th');
                                headerCell.textContent = label;
                                row.appendChild(headerCell);

                                const values = [];
                                if (colIndex === 0) {
                                    zonesData.forEach((zone, index) => values.push(index + 1));
                                } else if (colIndex === 1) {
                                    zonesData.forEach(zone => values.push(zone.num));
                                } else {
                                    zonesData.forEach(zone => values.push(zone.pitch));
                                }

                                values.forEach((value, cellIndex) => {
                                    const cell = document.createElement('td');
                                    cell.textContent = value;
                                    if (highlightedZoneDisplayIndex === cellIndex + 1) {
                                        cell.classList.add('focused-zone-form');
                                    }
                                    if (cellIndex < zonesPerLabel) {
                                        cell.classList.add('first-label-zone');
                                    }
                                    row.appendChild(cell);
                                });

                                tbody.appendChild(row);
                            });
                        }
			
			
			// Build an SVG dimension line group
			function buildDimensionLineSvg(x1, y1, x2, y2, label, offset = 0, textClass = 'dim-text-default', lineClass = 'dim-line-default', textAnchor = 'center') {
			    let svg = `<g class="dimension">`;
			    const tickSize = 4;
			    // Main dimension line
			    svg += `<line class="${lineClass}" x1="${Math.round(x1)}" y1="${Math.round(y1)}" x2="${Math.round(x2)}" y2="${Math.round(y1)}"/>`;
			    // Ticks
			    svg += `<line class="${lineClass}" x1="${Math.round(x1)}" y1="${Math.round(y1 - tickSize)}" x2="${Math.round(x1)}" y2="${Math.round(y1 + tickSize)}"/>`;
			    svg += `<line class="${lineClass}" x1="${Math.round(x2)}" y1="${Math.round(y1 - tickSize)}" x2="${Math.round(x2)}" y2="${Math.round(y1 + tickSize)}"/>`;
			    // Text
			    let textAnchorValue = 'middle';
			    let textX = Math.round((x1 + x2) / 2);
			    if (textAnchor === 'left') {
			        textAnchorValue = 'start';
			        textX = Math.round(x1 + TEXT_ABOVE_LINE_OFFSET);
			    } else if (textAnchor === 'right') {
			        textAnchorValue = 'end';
			        textX = Math.round(x2 - TEXT_ABOVE_LINE_OFFSET);
			    }
			    const textY = Math.round(y1 - TEXT_ABOVE_LINE_OFFSET + offset);
			    svg += `<text class="${textClass}" x="${textX}" y="${textY}" text-anchor="${textAnchorValue}">${label}</text>`;
			    svg += `</g>`;
			    return svg;
			}
			
			// Main function to draw the SVG preview of the cage
			function drawCagePreview() {
			    const svgContainer = document.getElementById('cagePreviewSvg');
			    const svgWrapper = document.getElementById('cagePreviewSvgContainer');
			    const errorEl = document.getElementById('previewError');
			    errorEl.textContent = '';
			    errorEl.className = 'info-text';
			
			    const width = svgWrapper.clientWidth;
			    const height = 320;
			    svgContainer.setAttribute('width', width.toString());
			    svgContainer.setAttribute('height', height.toString());
			    svgContainer.setAttribute('viewBox', `0 0 ${width} ${height}`);
			
			    let svgContent = `<defs><style type="text/css"><![CDATA[
			    .main-bar{stroke:var(--secondary-color);stroke-width:1.5px;}
			    .overhang-rect{fill:rgba(108,117,125,.08);}
			    .stirrup{stroke-linecap:round;}
			    .dim-line-default{stroke:var(--svg-dim-line-color);stroke-width:.8px;}
			    .dim-text-default{font-family:${SVG_FONT_FAMILY};font-size:${SVG_DIM_FONT_SIZE};fill:var(--svg-text-color);}
			    .dim-text-overhang{font-family:${SVG_FONT_FAMILY};font-size:${SVG_DIM_FONT_SIZE};fill:#000000;}
			    .dim-text-total{font-family:${SVG_FONT_FAMILY};font-size:${SVG_TOTAL_DIM_FONT_SIZE};font-weight:bold;fill:var(--text-color);}
			    .dim-text-single-stirrup{font-family:${SVG_FONT_FAMILY};font-size:${SVG_SINGLE_STIRRUP_FONT_SIZE};}
			    .dim-text-inter-zone{font-family:${SVG_FONT_FAMILY};font-size:${SVG_DIM_FONT_SIZE};fill:var(--secondary-color);}
			    `;
			    // Add dynamic zone colors
			    for (let i = 0; i < NUM_ZONE_COLORS_AVAILABLE; i++) {
			        let color = getComputedStyle(document.documentElement).getPropertyValue(`--svg-zone-color-${i}`)?.trim();
			        let r = 0, g = 0, b = 0;
			        if (color && color.startsWith('#')) {
			            r = parseInt(color.substring(1, 3), 16);
			            g = parseInt(color.substring(3, 5), 16);
			            b = parseInt(color.substring(5, 7), 16);
			            svgContent += `.zone-${i}-stroke{stroke:var(--svg-zone-color-${i});}
			                            .zone-${i}-fill{fill:var(--svg-zone-color-${i});}
			                            .zone-${i}-bg-fill{fill:rgba(${r},${g},${b},.1);}`;
			        } else {
			            svgContent += `.zone-${i}-stroke{stroke:#888;}
			                            .zone-${i}-fill{fill:#888;}
			                            .zone-${i}-bg-fill{fill:rgba(128,128,128,.1);}`;
			        }
			    }
			    const highlightRgba = getComputedStyle(document.documentElement).getPropertyValue('--svg-highlight-bg-color-rgba')?.trim() || "214, 51, 132";
			    svgContent += `.highlight-stroke{stroke:var(--svg-highlight-color)!important;}
			                    .highlight-fill{fill:var(--svg-highlight-color)!important;}
			                    .${HIGHLIGHT_BG_FILL_CLASS}{fill:rgba(${highlightRgba},.15)!important;}
			                    .leerraum-fill{fill:url(#hatchPattern);opacity:.5;}
			                    .dimension text{dominant-baseline:middle;}
			                    ]]></style>
			    <pattern id="hatchPattern" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
			        <line x1="0" y1="0" x2="0" y2="6" stroke="var(--hatch-line-color)" stroke-width=".7"/>
			    </pattern>
			    </defs>
			    `;
			    svgContent += '<g class="cage-drawing-group">';
			
			    try {
			        const totalLength = parseFloat(document.getElementById('gesamtlange').value) || 0;
			        if (totalLength <= 0) {
			            errorEl.textContent = 'Gesamtlänge muss größer als 0 sein.';
			            errorEl.classList.add('error');
			            svgContainer.innerHTML = svgContent + '</g>';
			            return;
			        }
			
			        const initialOverhang = parseFloat(document.getElementById('anfangsueberstand').value) || 0;
			        const finalOverhang = parseFloat(document.getElementById('endueberstand').value) || 0;
			        const drawingWidth = width - 2 * PADDING_VISUAL;
			        if (drawingWidth <= 0) {
			            svgContainer.innerHTML = svgContent + '</g>';
			            return;
			        }
			
			        const scale = drawingWidth / totalLength;
			        const centerY = height / 2 - 20;
			
			        svgContent += '<g class="main-bars-group">';
			        const barYTop = Math.round(centerY - STIRRUP_HEIGHT_VISUAL / 3.5);
			        const barYBottom = Math.round(centerY + STIRRUP_HEIGHT_VISUAL / 3.5);
			        const startX = Math.round(PADDING_VISUAL);
			        const endX = Math.round(PADDING_VISUAL + totalLength * scale);
			        svgContent += `<line class="main-bar" x1="${startX}" y1="${barYTop}" x2="${endX}" y2="${barYTop}"/>`;
			        svgContent += `<line class="main-bar" x1="${startX}" y1="${barYBottom}" x2="${endX}" y2="${barYBottom}"/>`;
			        svgContent += '</g>';
			
			        let currentPositionMm = initialOverhang;
			        let stirrupZoneTotalLength = 0;
			        const dimY = centerY + STIRRUP_HEIGHT_VISUAL / 2 + DIM_LINE_OFFSET_BELOW;
			        const dimYInter = dimY + 25;
			        const dimYPitch = centerY - STIRRUP_HEIGHT_VISUAL / 2 - DIM_LINE_OFFSET_ABOVE;
			
                                if (showOverhangs) {
                                    svgContent += '<g class="initial-overhang-group">';
                                    const initialOverhangScaled = PADDING_VISUAL + initialOverhang * scale;
                                    svgContent += `<rect class="overhang-rect" x="${Math.round(PADDING_VISUAL)}" y="${Math.round(centerY - STIRRUP_HEIGHT_VISUAL / 2)}" width="${Math.max(0, Math.round(initialOverhang * scale))}" height="${Math.round(STIRRUP_HEIGHT_VISUAL)}"/>`;
                                    if (initialOverhang > 0) {
                                        svgContent += buildDimensionLineSvg(PADDING_VISUAL, dimY, initialOverhangScaled, dimY, `i=${initialOverhang}mm`, 0, 'dim-text-overhang', 'dim-line-default', 'center');
                                    }
                                    svgContent += '</g>';
                                }
			
                                svgContent += '<g class="stirrup-zones-group">';
                                zonesData.forEach((zone, index) => {
                                    const zoneStart = currentPositionMm;
                                    const displayIndex = index + 1;
                                    const numStirrups = zone.num;
                                    const pitch = zone.pitch;
                                    const dia = zone.dia;

                                    const zoneWidth = numStirrups * pitch;
                                    const zoneLength = numStirrups > 1 && pitch > 0 ? (numStirrups - 1) * pitch : 0;
                                    stirrupZoneTotalLength += zoneWidth;

                                    const isHighlighted = highlightedZoneDisplayIndex === displayIndex;
                                    const zoneColorIndex = index % NUM_ZONE_COLORS_AVAILABLE;
                                    const stirrupStrokeClass = isHighlighted ? HIGHLIGHT_COLOR_CLASS_STROKE : `zone-${zoneColorIndex}-stroke`;
                                    const stirrupFillClass = isHighlighted ? HIGHLIGHT_COLOR_CLASS_FILL : `zone-${zoneColorIndex}-fill`;
                                    const zoneBgFillClass = isHighlighted ? HIGHLIGHT_BG_FILL_CLASS : `zone-${zoneColorIndex}-bg-fill`;
                                    let stirrupStrokeWidth = Math.max(1, Math.min(3.5, dia / 3));
                                    let highlightedStrokeWidth = isHighlighted ? stirrupStrokeWidth + 1 : stirrupStrokeWidth;

                                    svgContent += `<g class="stirrup-zone zone-group-${displayIndex} ${isHighlighted ? 'highlighted-svg-zone' : ''}" onmouseover="setHighlightedZone(${displayIndex},true)" onmouseout="setHighlightedZone(${displayIndex},false)">`;

                                    if (numStirrups > 0) {
                                        const zoneStartScaled = PADDING_VISUAL + zoneStart * scale;
                                        if (zoneLength > 0) {
                                            svgContent += `<rect class="${zoneBgFillClass}" x="${Math.round(zoneStartScaled)}" y="${Math.round(centerY - STIRRUP_HEIGHT_VISUAL / 2)}" width="${Math.round(zoneLength * scale)}" height="${Math.round(STIRRUP_HEIGHT_VISUAL)}"/>`;
                                        }
                                        for (let j = 0; j < numStirrups; j++) {
                                            const stirrupPos = zoneStart + j * pitch;
                                            const stirrupX = Math.round(PADDING_VISUAL + stirrupPos * scale);
                                            if (stirrupPos <= totalLength - finalOverhang + 1) {
                                                const isFirstStirrup = index === 0 && j === 0;
                                                const strokeClass = isFirstStirrup ? '' : stirrupStrokeClass;
                                                const strokeStyle = `stroke-width:${highlightedStrokeWidth}px${isFirstStirrup ? ';stroke:#000' : ''}`;
                                                svgContent += `<line class="stirrup ${strokeClass}" style="${strokeStyle}" x1="${stirrupX}" y1="${Math.round(centerY - STIRRUP_HEIGHT_VISUAL / 2)}" x2="${stirrupX}" y2="${Math.round(centerY + STIRRUP_HEIGHT_VISUAL / 2)}"/>`;
                                            }
                                        }

                                        const dimLineY = dimY + (index % 2) * INTER_ZONE_DIM_OFFSET;
                                        const dimLineYPitch = dimYPitch + (index % 2) * -INTER_ZONE_DIM_OFFSET;
                                        let dimLength = 0;
                                        let dimText = '';

                                        if (dimensioningMode === 'totalZoneSpace' && numStirrups > 0 && pitch > 0) {
                                            dimLength = numStirrups * pitch;
                                            dimText = `${numStirrups}x${pitch}=${dimLength}`;
                                            const dimEndScaled = PADDING_VISUAL + (zoneStart + dimLength) * scale;
                                            if (dimLength > 0) {
                                                svgContent += buildDimensionLineSvg(zoneStartScaled, dimLineY, dimEndScaled, dimLineY, dimText, 0, `dim-text-default ${zoneColorIndex}`, `dim-line-default ${zoneColorIndex}`, 'center');
                                            }
                                        } else if (numStirrups > 1 && pitch > 0) {
                                            dimLength = (numStirrups - 1) * pitch;
                                            dimText = `${numStirrups-1}x${pitch}=${dimLength}`;
                                            const dimEndScaled = PADDING_VISUAL + (zoneStart + dimLength) * scale;
                                            svgContent += buildDimensionLineSvg(zoneStartScaled, dimLineY, dimEndScaled, dimLineY, dimText, 0, `dim-text-default ${zoneColorIndex}`, `dim-line-default ${zoneColorIndex}`, 'center');
                                        } else if (numStirrups === 1) {
                                            // Special case for a single stirrup
                                            const stirrupScaled = PADDING_VISUAL + zoneStart * scale;
                                            let textX = stirrupScaled + (5 * scale > 7 ? 5 * scale : 7);
                                            if (stirrupScaled + 30 > width - PADDING_VISUAL) {
                                                textX = stirrupScaled - 15;
                                            }
                                            svgContent += `<text class="dim-text-single-stirrup ${stirrupFillClass}" x="${Math.round(textX)}" y="${Math.round(dimLineY - 5)}" text-anchor="middle">1xØ${dia}</text>`;
                                        }

                                        // Pitch dimension for multi-stirrup zones
                                        if (numStirrups > 1 && pitch > 0) {
                                            const pitchStartScaled = PADDING_VISUAL + zoneStart * scale;
                                            const pitchEndScaled = pitchStartScaled + pitch * scale;
                                            if (pitchEndScaled <= zoneStartScaled + (zoneLength * scale) + 1.1 && pitch * scale > 5) {
                                                svgContent += buildDimensionLineSvg(pitchStartScaled, dimLineYPitch, pitchEndScaled, dimLineYPitch, `p=${pitch}`, 0, `dim-text-default ${zoneColorIndex}`, `dim-line-default ${zoneColorIndex}`, 'left');
                                            }
                                        }

                                        currentPositionMm += zoneWidth;
                                    }
                                    svgContent += `</g>`;
                                });
                                svgContent += '</g>';
			
			        const finalOverhangCalculated = totalLength - initialOverhang - stirrupZoneTotalLength;
			        const finalOverhangScaledStart = PADDING_VISUAL + (totalLength - finalOverhang) * scale;
			        const finalOverhangScaledEnd = PADDING_VISUAL + totalLength * scale;
			
			        if (stirrupZoneTotalLength < totalLength - initialOverhang - finalOverhang - 0.1) {
			            const leerraumStart = PADDING_VISUAL + (initialOverhang + stirrupZoneTotalLength) * scale;
			            const leerraumEnd = PADDING_VISUAL + (totalLength - finalOverhang) * scale;
			            svgContent += '<g class="leerraum-visual-group">';
			            svgContent += `<rect class="leerraum-fill" x="${Math.round(leerraumStart)}" y="${Math.round(centerY - STIRRUP_HEIGHT_VISUAL / 2)}" width="${Math.round(leerraumEnd - leerraumStart)}" height="${Math.round(STIRRUP_HEIGHT_VISUAL)}"/>`;
			            svgContent += '</g>';
			        }
			
                                if (showOverhangs) {
                                    svgContent += '<g class="final-overhang-group">';
                                    const endOverhangStart = PADDING_VISUAL + (totalLength - finalOverhang) * scale;
                                    const endOverhangEnd = PADDING_VISUAL + totalLength * scale;
                                    svgContent += `<rect class="overhang-rect" x="${Math.round(endOverhangStart)}" y="${Math.round(centerY - STIRRUP_HEIGHT_VISUAL / 2)}" width="${Math.max(0, Math.round(finalOverhang * scale))}" height="${Math.round(STIRRUP_HEIGHT_VISUAL)}"/>`;
                                    if (finalOverhang > 0) {
                                        svgContent += buildDimensionLineSvg(finalOverhangScaledStart, dimY, finalOverhangScaledEnd, dimY, `f=${finalOverhang}mm`, 0, 'dim-text-overhang', 'dim-line-default', 'right');
                                    }
                                    svgContent += '</g>';
                                }
			
			        let remainingSpace = totalLength - initialOverhang - finalOverhang;
			        if (Math.abs(stirrupZoneTotalLength - remainingSpace) > 0.1 && stirrupZoneTotalLength < remainingSpace) {
			            errorEl.textContent = `Warnung: Leerraum (${(remainingSpace - stirrupZoneTotalLength).toFixed(1)}mm).`;
			            errorEl.classList.add('warning');
			        } else if (stirrupZoneTotalLength > remainingSpace + 0.1) {
			            errorEl.textContent = `Fehler: Bügelzonen (${stirrupZoneTotalLength.toFixed(1)}mm) > Platz (${remainingSpace.toFixed(1)}mm)!`;
			            errorEl.classList.add('error');
			        }
			        
			        svgContent += '<g class="total-length-dimension-group">';
			        svgContent += buildDimensionLineSvg(PADDING_VISUAL, height - PADDING_VISUAL + 10, PADDING_VISUAL + totalLength * scale, height - PADDING_VISUAL + 10, `Gesamtlänge L = ${totalLength}mm`, 0, 'dim-text-total', 'dim-line-default', 'center');
			        svgContent += '</g>';
			        
			        svgContent += '</g>';
                                svgContainer.innerHTML = svgContent;
                            } catch (e) {
                                console.error("Fehler beim Zeichnen der SVG-Vorschau:", e);
                                errorEl.textContent = "Fehler Vorschau (SVG): " + e.message;
                                errorEl.classList.add('error');
                                if (e && svgContent) {
                                    svgContainer.innerHTML = svgContent.endsWith("</g>") ? svgContent : svgContent + "</g>";
                                }
                            }
                            updateGenerateButtonState();
                        }
			
			// Calculate the BVBS checksum
			function calculateChecksum(bvbsCode) {
			    let sum = 0;
			    for (let i = 0; i < bvbsCode.length; i++) {
			        sum += bvbsCode.charCodeAt(i);
			    }
			    return 96 - (sum % 32);
			}
			
			// Main function to generate BVBS code and trigger barcode creation
			function generateBvbsCodeAndBarcode() {
                            const errorEl = document.getElementById('barcodeError');
                            errorEl.textContent = '';
                            const output1 = document.getElementById('outputBvbsCode1');
                            const output2 = document.getElementById('outputBvbsCode2');
                            const outputField2 = document.getElementById('bvbsOutputField2');
                            if (output1) output1.value = '';
                            if (output2) output2.value = '';
                            if (outputField2) outputField2.style.display = 'none';
                            const barcodeContainer = document.getElementById('barcodeSvgContainer');
                            barcodeContainer.innerHTML = '';
                            barcodeContainer.classList.add('hidden');
			
			    let isValid = true;
			    // Validate all form fields before generation
			    const inputsToValidate = [{
			        id: 'gesamtlange',
			        min: 1,
			        type: 'int',
			        info: 'Gesamtlänge in mm (min. 1)'
			    }, {
			        id: 'anzahl',
			        min: 1,
			        type: 'int',
			        info: 'Anzahl Körbe (min. 1)'
			    }, {
			        id: 'langdrahtDurchmesser',
			        min: 1,
			        type: 'int',
			        info: 'Längsdraht-Ø in mm (min. 1)'
			    }, {
			        id: 'anfangsueberstand',
			        min: 0,
			        type: 'int',
			        info: 'Anfangsüberstand in mm (min. 0)'
			    }, {
			        id: 'endueberstand',
			        min: 0,
			        type: 'int',
			        info: 'Endüberstand in mm (min. 0)'
			    }];
			
			    inputsToValidate.forEach(input => {
			        const el = document.getElementById(input.id);
			        if (el && !validateNumberInput(el, input.min, input.type, input.info)) {
			            isValid = false;
			        }
			    });
			
			    zonesData.forEach(zone => {
			        const diaEl = document.getElementById(`durchmesser-${zone.id}`);
			        if (diaEl && !validateNumberInput(diaEl, 6, 'int', 'Mind. 6mm')) {
			            isValid = false;
			        }
			        const numEl = document.getElementById(`anzahlBUEGEL-${zone.id}`);
			        if (numEl && !validateNumberInput(numEl, 0, 'int', 'Anzahl >= 0')) {
			            isValid = false;
			        }
			        const pitchEl = document.getElementById(`pitch-${zone.id}`);
			        if (pitchEl && !validateNumberInput(pitchEl, 1, 'int', 'Pitch >= 1mm')) {
			            isValid = false;
			        }
			    });
			
			    if (!isValid) {
			        showFeedback('barcodeError', "Bitte korrigieren Sie die markierten Eingabefehler.", 'error', 5000);
			        updateLabelPreview();
			        return;
			    }
			
			    try {
			        // Get all input values
			        const projekt = document.getElementById('projekt').value;
			        const KommNr = document.getElementById('KommNr').value;
			        const auftrag = document.getElementById('auftrag').value;
			        const posnr = document.getElementById('posnr').value;
			        const gesamtlange = document.getElementById('gesamtlange').value;
			        const anzahl = document.getElementById('anzahl').value;
                                const langdrahtDurchmesser = document.getElementById('langdrahtDurchmesser').value;
                                const anfangsueberstand = document.getElementById('anfangsueberstand').value;
                                const endueberstand = document.getElementById('endueberstand').value;
                                const buegelname1 = document.getElementById('buegelname1').value.trim();
                                const buegelname2 = document.getElementById('buegelname2').value.trim();
                                const rezeptname = document.getElementById('rezeptname').value.trim();

                                if (zonesData.length > zonesPerLabel && !buegelname2) {
                                    updateGenerateButtonState();
                                    return;
                                }

                                const buildCode = (zonesArr, startOv, endOv, name) => {
                                    let head = `BF2D@Hj${projekt}@r${KommNr}@i${auftrag}@p${posnr}@l${gesamtlange}@n${anzahl}@d${langdrahtDurchmesser}@e@g@s@v@`;
                                    let pt = "PtGABBIE;";
                                    pt += `i${startOv};`;
                                    pt += `f${endOv};`;
                                    zonesArr.forEach(z => { pt += `d${z.dia};n${z.num};p${z.pitch};`; });
                                    if (name) pt += `s${name};`;
                                    if (rezeptname) pt += `r${rezeptname};`;
                                    if (pt.endsWith(';')) pt = pt.slice(0,-1);
                                    pt += "@";
                                    const pre = head + pt + "C";
                                    const cs = calculateChecksum(pre);
                                    return pre + cs + "@";
                                };
                                let finalBvbsCode = buildCode(zonesData, anfangsueberstand, endueberstand, buegelname1);
                                let finalBvbsCode2 = null;
                                if (zonesData.length > zonesPerLabel) {
                                    const firstZones = zonesData.slice(0, zonesPerLabel);
                                    const secondZones = zonesData.slice(zonesPerLabel);
                                    finalBvbsCode = buildCode(firstZones, anfangsueberstand, 0, buegelname1);
                                    const startOvSecond = zonesData[zonesPerLabel - 1]?.pitch || 0;
                                    finalBvbsCode2 = buildCode(secondZones, startOvSecond, endueberstand, buegelname2);
                                }
                                const out1 = document.getElementById('outputBvbsCode1');
                                const out2 = document.getElementById('outputBvbsCode2');
                                const field2 = document.getElementById('bvbsOutputField2');
                                if (out1) out1.value = finalBvbsCode;
                                if (finalBvbsCode2 && out2 && field2) {
                                    out2.value = finalBvbsCode2;
                                    field2.style.display = 'flex';
                                } else if (out2 && field2) {
                                    out2.value = '';
                                    field2.style.display = 'none';
                                }

                                updateBarcodeDebugInfo(`Generated BVBS code: ${finalBvbsCode}`);
                                updateBarcodeDebugInfo(`Code length: ${finalBvbsCode.length}${finalBvbsCode2 ? '/' + finalBvbsCode2.length : ''}`);
			
			        // Check for library before trying to use it
			        if (typeof bwipjs === 'undefined') {
			            console.error("bwip-js library not loaded!");
			            updateBarcodeDebugInfo("bwip-js Bibliothek nicht geladen!");
			            showFeedback('barcodeError', 'Fehler: Barcode-Bibliothek nicht geladen. Bitte Seite neu laden.', 'error', 5000);
                                createFallbackBarcode(finalBvbsCode, finalBvbsCode2);
			            return;
			        }
			
			        generatePDF417Barcode(finalBvbsCode);
			
			    } catch (e) {
			        console.error("Error in generateBvbsCodeAndBarcode:", e);
                                updateBarcodeDebugInfo(`Fehler bei Code-Generierung: ${e.message}`);
                                const outErr = document.getElementById('outputBvbsCode1');
                                if (outErr) outErr.value = 'Fehler: ' + e.message;
			        showFeedback('barcodeError', "Fehler: " + e.message, 'error', 5000);
			        barcodeContainer.innerHTML = '';
			        barcodeContainer.classList.add('hidden');
			        updateLabelPreview();
			    }
			}
			
			// Generate the PDF417 barcode
			/**
			* Erzeugt im PDF417‑Card den Barcode als Canvas.
			* Schreibt ihn in das Element mit ID "barcodeSvgContainer".
			*/
			function generatePDF417Barcode(bvbsCode) {
			const container = document.getElementById('barcodeSvgContainer');
			const errorEl   = document.getElementById('barcodeError');
			
			if (!container) {
			console.error('Kein Element mit ID "barcodeSvgContainer" gefunden.');
			return;
			}
			if (errorEl) {
			errorEl.textContent = '';
			}
			
			// Alten Inhalt löschen
			container.innerHTML = '';
			
			try {
			// Neues Canvas erzeugen
			const canvas = document.createElement('canvas');
			
			// bwip-js: Canvas‑Barcode generieren
			bwipjs.toCanvas(canvas, {
			    bcid:        'pdf417',      // Barcode‑Typ
			    text:        bvbsCode,      // zu codierender Text
			scaleX:  2,
			scaleY:  4,             // Skalierung
			    height:      12,            // Höhe
			    includetext: true,          // Text unter Barcode
			    textxalign:  'center',      // Text zentriert
			    textsize:    15              // Textgröße
			});
			
			// Canvas ins DOM hängen
			container.appendChild(canvas);
			
			// Status aktualisieren
			updateBarcodeStatus();
			
			} catch (err) {
			console.error('Error generating PDF417 canvas barcode:', err);
			if (errorEl) {
			    errorEl.textContent = `Fehler beim Erstellen des Canvas-Barcodes: ${err.message}`;
			    errorEl.classList.add('error');
			}
			// optional: Fallback-Text anzeigen
			container.textContent = bvbsCode;
			}
			}
			
			
			
			// Fallback for barcode generation (e.g. if running from file:// protocol)
                        function createFallbackBarcode(code1, code2) {
                        const barcodeContainer = document.getElementById('barcodeSvgContainer');
                        const errorEl = document.getElementById('barcodeError');
                        barcodeContainer.innerHTML = '';
                        barcodeContainer.classList.add('hidden');
                        errorEl.textContent = '';
                        try {
                            updateBarcodeDebugInfo("Erstelle Fallback-Barcode (Text)");
                                const fill = (suffix, code) => {
                                    const labelImage = document.getElementById('labelBarcodeImage' + suffix);
                                    const labelText = document.getElementById('labelBarcodeText' + suffix);
                                    if (labelImage) {
                                        labelImage.src = '';
                                        labelImage.style.display = 'none';
                                    }
                                    if (labelText) {
                                        labelText.textContent = code;
                                        labelText.style.display = 'block';
                                        labelText.style.fontStyle = 'normal';
                                        labelText.style.color = '#333';
                                    }
                                };

                                fill('', code1);
                                if (code2) fill('2', code2);
			        showFeedback('barcodeError', 'Barcode-Generierung fehlgeschlagen. Es wird ein Text-Fallback angezeigt.', 'warning', 5000);
			        updateBarcodeDebugInfo("Fallback-Barcode (Text) erfolgreich erstellt");
			        updateLabelPreview(null);
			    } catch (e) {
			        console.error("Even fallback barcode creation failed:", e);
			        updateBarcodeDebugInfo(`Fallback (Text) fehlgeschlagen: ${e.message}`);
			        showFeedback('barcodeError', 'Barcode-Generierung fehlgeschlagen. Es gibt keinen Fallback.', 'error', 5000);
			        updateLabelPreview(null);
			    }
			}
			
			// Update the printable label preview
			// Update the printable label preview
function updateLabelPreview(barcodeSvg) {
                        const projekt = document.getElementById('projekt').value || '-';
                        const KommNr  = document.getElementById('KommNr').value || '-';
                        const buegelname1 = document.getElementById('buegelname1').value || '-';
                        const buegelname2 = document.getElementById('buegelname2').value || '-';
                        const auftrag = document.getElementById('auftrag').value || '-';
                        const gesamtlange = (document.getElementById('gesamtlange').value || '-') + ' mm';
                        const posnr = document.getElementById('posnr').value || '-';

                        const codes = getBvbsCodes();

                        const suffixFirst = zonesData.length > zonesPerLabel ? '/1' : '';
                        const suffixSecond = zonesData.length > zonesPerLabel ? '/2' : '';

                        const fillLabel = (idSuffix, suffix, name) => {

                            document.getElementById('labelProjekt' + idSuffix).textContent = projekt;
                            document.getElementById('labelKommNr' + idSuffix).textContent = KommNr;
                            document.getElementById('labelBuegelname' + idSuffix).textContent = name;
                            document.getElementById('labelAuftrag' + idSuffix).textContent = auftrag;
                            document.getElementById('labelGesamtlange' + idSuffix).textContent = gesamtlange;

                            document.getElementById('labelPosnr' + idSuffix).textContent = posnr + suffix;
                        };

                        fillLabel('', suffixFirst, buegelname1);

                        const second = document.getElementById('printableLabel2');
                        if (second) {
                            if (zonesData.length > zonesPerLabel) {
                                second.style.display = 'block';
                                document.body.classList.add('two-page');

                                fillLabel('2', suffixSecond, buegelname2);

                            } else {
                                second.style.display = 'none';
                                document.body.classList.remove('two-page');
                            }
                        } else {
                            document.body.classList.remove('two-page');
                        }

                        const labelImage  = document.getElementById('labelBarcodeImage');
                        const labelText   = document.getElementById('labelBarcodeText');
                        const labelImage2 = document.getElementById('labelBarcodeImage2');
                        const labelText2  = document.getElementById('labelBarcodeText2');

                        if (barcodeSvg) {
                        labelImage.src         = `data:image/svg+xml;base64,${btoa(barcodeSvg)}`;
                        labelImage.style.display = 'block';
                        labelText.style.display  = 'none';
                        if (labelImage2 && labelText2) {
                            labelImage2.style.display = 'none';
                            labelText2.textContent = codes[1] || '';
                            labelText2.style.display = codes[1] ? 'block' : 'none';
                        }
                        }
                        else if (codes.length) {
                        labelImage.style.display = 'none';
                        labelText.textContent    = codes[0] || '';
                        labelText.style.display  = 'block';
                        if (labelImage2 && labelText2) {
                            labelImage2.style.display = 'none';
                            labelText2.textContent = codes[1] || '';
                            labelText2.style.display = codes[1] ? 'block' : 'none';
                        }
                        }
                        else {
                        labelImage.style.display = 'none';
                        labelText.textContent    = '';
                        labelText.style.display  = 'block';
                        if (labelImage2 && labelText2) {
                            labelImage2.style.display = 'none';
                            labelText2.textContent = '';
                            labelText2.style.display = 'none';
                        }
                        }
                        applyLabelLayout();
                        updateGenerateButtonState();
                        }
			
			
			// Initial setup on page load
			document.addEventListener('DOMContentLoaded', () => {
                            initCollapsibleHeaders();
                            loadTemplatesFromFile();
                            loadLabelLayout();
                            applyLabelLayout();
                            LABEL_ELEMENT_IDS.forEach(id => {
                                const el = document.getElementById(id);
                                if (el) makeElementDraggable(el);
                                const el2 = document.getElementById(id + '2');
                                if (el2) makeElementDraggable(el2);
                            });
			
			    // Event listeners
                            document.getElementById('addZoneButton')?.addEventListener('click', () => addZone());
                            document.getElementById('maxZonesInput')?.addEventListener('input', (e) => updateMaxZones(e.target.value));
                            const maxZonesEl = document.getElementById('maxZonesInput');
                            if (maxZonesEl) {
                                updateMaxZones(maxZonesEl.value);
                            }
                            document.getElementById('zonesPerLabelInput')?.addEventListener('input', (e) => updateZonesPerLabel(e.target.value));
                            const zonesPerLabelEl = document.getElementById('zonesPerLabelInput');
                            if (zonesPerLabelEl) {
                                updateZonesPerLabel(zonesPerLabelEl.value);
                            }
                            document.getElementById('generateButton').addEventListener('click', () => {
                        generateBvbsCodeAndBarcode();
                        updateLabelPreview();
                        const codes = getBvbsCodes();
                        if (codes.length > 0) {
                            generateBarcodeToLabel(codes[0], '');
                            if (codes.length > 1) {
                                generateBarcodeToLabel(codes[1], '2');
                            }
                        }
                        });

                            document.getElementById('buegelname2')?.addEventListener('input', () => updateGenerateButtonState());
			
			
			
			
                            document.querySelectorAll('.copy-bvbs-btn')?.forEach(btn => {
                                btn.addEventListener('click', async () => {
                                    const target = btn.getAttribute('data-target');
                                    const output = document.getElementById(target)?.value.trim();
                                    if (output) {
                                        try {
                                            await navigator.clipboard.writeText(output);
                                            showFeedback('copyFeedback', 'Code in die Zwischenablage kopiert!', 'success', 3000);
                                        } catch (err) {
                                            console.error('Fehler beim Kopieren: ', err);
                                            showFeedback('copyFeedback', 'Fehler beim Kopieren.', 'error', 3000);
                                        }
                                    }
                                });
                            });
                            document.getElementById('downloadSvgButton')?.addEventListener('click', () => {
                                const svgElement = document.getElementById('cagePreviewSvg');
                                if (!svgElement) return;
                                const svgString = new XMLSerializer().serializeToString(svgElement);
                                const blob = new Blob([svgString], { type: 'image/svg+xml' });
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement('a');
                                a.href = url;
                                a.download = 'korb_vorschau.svg';
                                document.body.appendChild(a);
                                a.click();
                                document.body.removeChild(a);
                                URL.revokeObjectURL(url);
                            });
                            document.querySelectorAll('.download-label-btn')?.forEach(btn => {
                                btn.addEventListener('click', () => {
                                    const target = btn.getAttribute('data-target');
                                    if (target) downloadLabelAsPng(target);
                                });
                            });
                            document.getElementById('printLabelButton')?.addEventListener('click', () => {
                                if (getBvbsCodes().length === 0) {
                                    showFeedback('barcodeError', 'Bitte generieren Sie zuerst den Code, um das Label zu drucken.', 'warning', 5000);
                                    return;
                                }
                                window.print();
                            });
                            document.getElementById('showZplButton')?.addEventListener('click', () => openZplModal());
                            document.getElementById('editLabelLayoutButton')?.addEventListener('click', () => toggleLabelDesignMode());
                            document.getElementById('openTemplateManagerButton')?.addEventListener('click', () => openTemplateManagerModal());
			    document.getElementById('saveCurrentTemplateButton')?.addEventListener('click', () => saveCurrentTemplate());
			    document.getElementById('downloadTemplatesButton')?.addEventListener('click', () => downloadTemplatesAsJson());
                            document.getElementById('deleteAllTemplatesButton')?.addEventListener('click', () => deleteAllTemplatesFromModal());
                            document.getElementById('clearDebugLogButton')?.addEventListener('click', () => {
                                const debugInfoEl = document.getElementById('barcodeDebugInfo');
                                if (debugInfoEl) debugInfoEl.textContent = '';
                                console.clear();
                                showFeedback('barcodeError', 'Debug-Log gelöscht.', 'info', 2000);
                            });
                            // Initial validation and rendering
                            const inputsToValidateOnLoad = [{
			        id: 'gesamtlange',
			        min: 1,
			        type: 'int',
			        info: 'Gesamtlänge in mm (min. 1)'
			    }, {
			        id: 'anzahl',
			        min: 1,
			        type: 'int',
			        info: 'Anzahl Körbe (min. 1)'
			    }, {
			        id: 'langdrahtDurchmesser',
			        min: 1,
			        type: 'int',
			        info: 'Längsdraht-Ø in mm (min. 1)'
			    }, {
			        id: 'anfangsueberstand',
			        min: 0,
			        type: 'int',
			        info: 'Anfangsüberstand in mm (min. 0)'
			    }, {
			        id: 'endueberstand',
			        min: 0,
			        type: 'int',
			        info: 'Endüberstand in mm (min. 0)'
			    }];
			    inputsToValidateOnLoad.forEach(input => {
			        const el = document.getElementById(input.id);
			        if (el) {
			            el.addEventListener('input', () => validateNumberInput(el, input.min, input.type, input.info));
			            validateNumberInput(el, input.min, input.type, input.info);
			        }
			    });
			// ganz unten im DOMContentLoaded-Callback
                        updateLabelPreview();
                        const initialCodes = getBvbsCodes();
                        if (initialCodes.length > 0) {
                            generateBarcodeToLabel(initialCodes[0], '');
                            if (initialCodes.length > 1) {
                                generateBarcodeToLabel(initialCodes[1], '2');
                            }
                        }
			
                            renderAllZones();
                            updateAddZoneButtonState();
                            drawCagePreview();
                            // 1) Label mit Feldern befüllen
                            updateLabelPreview();
                            // 2) echten Barcode erzeugen (SVG im PDF417‑Card und Canvas im Label)
                            generateBvbsCodeAndBarcode();
                            updateGenerateButtonState();
			
			    
			    // Check library status after a short delay to ensure it's loaded
                            setTimeout(() => {
			        updateBarcodeStatus();
                                if (!checkBarcodeLibraryStatus()) {
                                    updateBarcodeDebugInfo('bwip-js Bibliothek nicht verfügbar');
                                } else {
                                    updateBarcodeDebugInfo('bwip-js Bibliothek erfolgreich geladen');
                                }
                            }, 1000);
                        });
			
			
                        function generateBarcodeToLabel(text, idSuffix = '') {
                        const container = document.getElementById('labelBarcodeContainer' + idSuffix);
                        if (!container) {
                        console.error('Kein Label‑Container gefunden!');
                        return;
                        }
                        container.innerHTML = '';

                        const img = document.getElementById('labelBarcodeImage' + idSuffix);
                        const txt = document.getElementById('labelBarcodeText' + idSuffix);
                        if (img) img.style.display = 'none';
                        if (txt) txt.style.display = 'none';
			
			// create a new canvas
			const canvas = document.createElement('canvas');
			try {
                        bwipjs.toCanvas(canvas, {
                        bcid:        'pdf417',    // Barcode‑Typ
                        text:        text,        // Dein BVBS‑Code
                        scaleX:      3,           // breit
                        scaleY:      4,           // hoch
                        height:      15,          // Stirrup‑Höhe
                        includetext: false        // kein Text unterm Barcode
                        });
			container.appendChild(canvas);
			} catch (err) {
                        console.error('Barcode Label Fehler:', err);
                        // als Fallback einfach den rohen Text anzeigen
                        if (txt) {
                        txt.textContent = text;
                        txt.style.display = 'block';
                        }
                        }
                        }

                        function generateZplForLabel(idSuffix = '') {
                            const getText = (id) => document.getElementById(id + idSuffix)?.textContent || '';
                            const pos = getText('labelPosnr');
                            const komm = getText('labelKommNr');
                            const name = getText('labelBuegelname');
                            const proj = getText('labelProjekt');
                            const auftrag = getText('labelAuftrag');
                            const laenge = getText('labelGesamtlange');
                            const codes = getBvbsCodes();
                            const code = idSuffix === '2' ? (codes[1] || '') : (codes[0] || '');

                            let zpl = '^XA\n';
                            zpl += `^FO20,20^A0N,40,40^FDPos: ${pos}^FS\n`;
                            zpl += `^FO20,70^A0N,30,30^FD${komm}^FS\n`;
                            zpl += `^FO20,110^A0N,30,30^FD${name}^FS\n`;
                            zpl += `^FO20,150^A0N,30,30^FDProjekt: ${proj}^FS\n`;
                            zpl += `^FO20,190^A0N,30,30^FDAuftrag: ${auftrag}^FS\n`;
                            zpl += `^FO20,230^A0N,30,30^FDL\xC3\xA4nge: ${laenge}^FS\n`;
                            if (code) {
                                zpl += `^FO20,270^B7N,4,3^FD${code}^FS\n`;
                            }
                            zpl += '^XZ';
                            return zpl;
                        }
			
			
