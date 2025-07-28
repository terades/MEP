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
const MAX_ZONES = 20; // maximale Anzahl an Zonen
			
			// Highlight classes
			const HIGHLIGHT_COLOR_CLASS_STROKE = 'highlight-stroke';
			const HIGHLIGHT_COLOR_CLASS_FILL = 'highlight-fill';
			const HIGHLIGHT_BG_FILL_CLASS = 'highlight-bg-fill';
			
			let previewUpdateTimer;
			let highlightedZoneDisplayIndex = null;
			let dimensioningMode = 'arrangementLength'; // 'arrangementLength' or 'totalZoneSpace'
			
			// Local storage key for templates
			const LOCAL_STORAGE_TEMPLATES_KEY = 'bvbsKorbsTemplates';
			
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
			
			// Updates the barcode status text
			function updateBarcodeStatus() {
			    const statusEl = document.getElementById('barcodeStatus');
			    const barcodeContainer = document.getElementById('barcodeSvgContainer');
			    const bvbsCode = document.getElementById('outputBvbsCode')?.value?.trim() || '';
			    if (!statusEl) return;
			    if (barcodeContainer && barcodeContainer.querySelector('svg') && !barcodeContainer.classList.contains('hidden')) {
			        statusEl.textContent = 'Barcode generiert';
			        statusEl.style.color = 'var(--success-color)';
			    } else if (bvbsCode && bvbsCode.length > 10) {
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
			                // Add some default zones if no template is found
			                addZone(8, 2, 100);
			                addZone(8, 2, 100);
			                addZone(8, 2, 100);
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
			        // Add some default zones on error
			        addZone(8, 2, 100);
			        addZone(8, 2, 100);
			        addZone(8, 2, 100);
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
			    showFeedback('templateFeedback', "lagen.json heruntergeladen! Bitte manuell in den Projektordner verschieben.", 'info', 5000);
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
                        function addZone(dia = 8, num = 3, pitch = 150) {
                            if (zonesData.length >= MAX_ZONES) {
                                showFeedback('templateFeedback', 'Maximale Zonenanzahl erreicht.', 'warning', 3000);
                                return;
                            }
                            zonesData.push({
                                id: nextZoneId++,
                                dia: dia,
                                num: num,
                                pitch: pitch
                            });
                            renderAllZones();

                            if (zonesData.length >= MAX_ZONES) {
                                const btn = document.getElementById('addZoneButton');
                                if (btn) btn.disabled = true;
                            }
			
			    // Scroll to the new zone and briefly highlight it
			    setTimeout(() => {
			        const newRow = document.querySelector(`#zonesTable tr[data-zone-id="${nextZoneId - 1}"]`);
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
                            if (zonesData.length < MAX_ZONES) {
                                const btn = document.getElementById('addZoneButton');
                                if (btn) btn.disabled = false;
                            }
                            showFeedback('templateFeedback', 'Zone gelöscht.', 'success', 2000);
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
			    const data = [
			        [], // Zone numbers
			        [], // Number of stirrups per zone
			        [] // Pitch per zone
			    ];
			
			    zonesData.forEach((zone, index) => {
			        data[0].push(index + 1);
			        data[1].push(zone.num);
			        data[2].push(zone.pitch);
			    });
			
			    headerLabels.forEach((label, colIndex) => {
			        const row = document.createElement('tr');
			        const headerCell = document.createElement('th');
			        headerCell.textContent = label;
			        row.appendChild(headerCell);
			
			        if (data[colIndex].length > 0) {
			            data[colIndex].forEach((value, cellIndex) => {
			                const cell = document.createElement('td');
			                cell.textContent = value;
			                if (highlightedZoneDisplayIndex === cellIndex + 1) {
			                    cell.classList.add('focused-zone-form');
			                }
			                row.appendChild(cell);
			            });
			        } else {
			            const cell = document.createElement('td');
			            cell.textContent = "-";
			            row.appendChild(cell);
			        }
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
			
			        svgContent += '<g class="initial-overhang-group">';
			        const initialOverhangScaled = PADDING_VISUAL + initialOverhang * scale;
			        svgContent += `<rect class="overhang-rect" x="${Math.round(PADDING_VISUAL)}" y="${Math.round(centerY - STIRRUP_HEIGHT_VISUAL / 2)}" width="${Math.max(0, Math.round(initialOverhang * scale))}" height="${Math.round(STIRRUP_HEIGHT_VISUAL)}"/>`;
			        if (initialOverhang > 0) {
			            svgContent += buildDimensionLineSvg(PADDING_VISUAL, dimY, initialOverhangScaled, dimY, `i=${initialOverhang}mm`, 0, 'dim-text-overhang', 'dim-line-default', 'center');
			        }
			        svgContent += '</g>';
			
			        svgContent += '<g class="stirrup-zones-group">';
			        zonesData.forEach((zone, index) => {
			            const displayIndex = index + 1;
			            const numStirrups = zone.num;
			            const pitch = zone.pitch;
			            const dia = zone.dia;
			
			            const isHighlighted = highlightedZoneDisplayIndex === displayIndex;
			            const zoneColorIndex = index % NUM_ZONE_COLORS_AVAILABLE;
			            const stirrupStrokeClass = isHighlighted ? HIGHLIGHT_COLOR_CLASS_STROKE : `zone-${zoneColorIndex}-stroke`;
			            const stirrupFillClass = isHighlighted ? HIGHLIGHT_COLOR_CLASS_FILL : `zone-${zoneColorIndex}-fill`;
			            const zoneBgFillClass = isHighlighted ? HIGHLIGHT_BG_FILL_CLASS : `zone-${zoneColorIndex}-bg-fill`;
			            let stirrupStrokeWidth = Math.max(1, Math.min(3.5, dia / 3));
			            let highlightedStrokeWidth = isHighlighted ? stirrupStrokeWidth + 1 : stirrupStrokeWidth;
			
			            let zoneLength = 0;
			            if (numStirrups > 0) {
			                zoneLength = numStirrups === 1 && pitch > 0 ? pitch : (numStirrups > 1 && pitch > 0 ? (numStirrups - 1) * pitch : 0);
			            }
			            stirrupZoneTotalLength += zoneLength;
			
			            svgContent += `<g class="stirrup-zone zone-group-${displayIndex} ${isHighlighted ? 'highlighted-svg-zone' : ''}" onmouseover="setHighlightedZone(${displayIndex},true)" onmouseout="setHighlightedZone(${displayIndex},false)">`;
			
			            if (numStirrups > 0) {
			                const zoneStartScaled = PADDING_VISUAL + currentPositionMm * scale;
			                const zoneEndScaled = PADDING_VISUAL + (currentPositionMm + zoneLength) * scale;
			                if (zoneLength > 0) {
			                    svgContent += `<rect class="${zoneBgFillClass}" x="${Math.round(zoneStartScaled)}" y="${Math.round(centerY - STIRRUP_HEIGHT_VISUAL / 2)}" width="${Math.round(zoneLength * scale)}" height="${Math.round(STIRRUP_HEIGHT_VISUAL)}"/>`;
			                }
			                for (let j = 0; j < numStirrups; j++) {
			                    let stirrupOffset = (pitch > 0 && numStirrups > 1) ? j * pitch : 0;
			                    const stirrupX = Math.round(PADDING_VISUAL + (currentPositionMm + stirrupOffset) * scale);
			                    if (currentPositionMm + stirrupOffset <= totalLength - initialOverhang - finalOverhang + 1) {
			                        svgContent += `<line class="stirrup ${stirrupStrokeClass}" style="stroke-width:${highlightedStrokeWidth}px" x1="${stirrupX}" y1="${Math.round(centerY - STIRRUP_HEIGHT_VISUAL / 2)}" x2="${stirrupX}" y2="${Math.round(centerY + STIRRUP_HEIGHT_VISUAL / 2)}"/>`;
			                    }
			                }
			                
			                const dimLineY = dimY + (index % 2) * INTER_ZONE_DIM_OFFSET;
			                const dimLineYPitch = dimYPitch + (index % 2) * -INTER_ZONE_DIM_OFFSET;
			                let dimLength = 0;
			                let dimText = '';
			
			                if (dimensioningMode === 'totalZoneSpace' && numStirrups > 0 && pitch > 0) {
			                    dimLength = numStirrups * pitch;
			                    dimText = `${numStirrups}x${pitch}=${dimLength}`;
			                    const dimEndScaled = PADDING_VISUAL + (currentPositionMm + dimLength) * scale;
			                    if (dimLength > 0) {
			                        svgContent += buildDimensionLineSvg(zoneStartScaled, dimLineY, dimEndScaled, dimLineY, dimText, 0, `dim-text-default ${zoneColorIndex}`, `dim-line-default ${zoneColorIndex}`, 'center');
			                    }
			                } else if (numStirrups > 1 && pitch > 0) {
			                    dimLength = (numStirrups - 1) * pitch;
			                    dimText = `${numStirrups-1}x${pitch}=${dimLength}`;
			                    const dimEndScaled = PADDING_VISUAL + (currentPositionMm + dimLength) * scale;
			                    svgContent += buildDimensionLineSvg(zoneStartScaled, dimLineY, dimEndScaled, dimLineY, dimText, 0, `dim-text-default ${zoneColorIndex}`, `dim-line-default ${zoneColorIndex}`, 'center');
			                } else if (numStirrups === 1) {
			                    // Special case for a single stirrup
			                    let textX = zoneStartScaled + (5 * scale > 7 ? 5 * scale : 7);
			                    if (zoneStartScaled + 30 > width - PADDING_VISUAL) {
			                        textX = zoneStartScaled - 15;
			                    }
			                    svgContent += `<text class="dim-text-single-stirrup ${stirrupFillClass}" x="${Math.round(textX)}" y="${Math.round(dimLineY - 5)}" text-anchor="middle">1xØ${dia}</text>`;
			                }
			
			                // Pitch dimension for multi-stirrup zones
			                if (numStirrups > 1 && pitch > 0) {
			                    const pitchStartScaled = PADDING_VISUAL + currentPositionMm * scale;
			                    const pitchEndScaled = pitchStartScaled + pitch * scale;
			                    if (pitchEndScaled <= zoneStartScaled + (dimLength * scale) + 1.1 && pitch * scale > 5) {
			                        svgContent += buildDimensionLineSvg(pitchStartScaled, dimLineYPitch, pitchEndScaled, dimLineYPitch, `p=${pitch}`, 0, `dim-text-default ${zoneColorIndex}`, `dim-line-default ${zoneColorIndex}`, 'left');
			                    }
			                }
			
			                currentPositionMm += zoneLength;
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
			
			        svgContent += '<g class="final-overhang-group">';
			        const endOverhangStart = PADDING_VISUAL + (totalLength - finalOverhang) * scale;
			        const endOverhangEnd = PADDING_VISUAL + totalLength * scale;
			        svgContent += `<rect class="overhang-rect" x="${Math.round(endOverhangStart)}" y="${Math.round(centerY - STIRRUP_HEIGHT_VISUAL / 2)}" width="${Math.max(0, Math.round(finalOverhang * scale))}" height="${Math.round(STIRRUP_HEIGHT_VISUAL)}"/>`;
			        if (finalOverhang > 0) {
			            svgContent += buildDimensionLineSvg(finalOverhangScaledStart, dimY, finalOverhangScaledEnd, dimY, `f=${finalOverhang}mm`, 0, 'dim-text-overhang', 'dim-line-default', 'right');
			        }
			        svgContent += '</g>';
			
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
			    document.getElementById('outputBvbsCode').value = '';
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
			        const buegelname = document.getElementById('buegelname').value.trim();
			        const rezeptname = document.getElementById('rezeptname').value.trim();
			
                                const buildCode = (zonesArr, startOv, endOv) => {
                                    let head = `BF2D@Hj${projekt}@r${KommNr}@i${auftrag}@p${posnr}@l${gesamtlange}@n${anzahl}@d${langdrahtDurchmesser}@e@g@s@v@`;
                                    let pt = "PtGABBIE;";
                                    pt += `i${startOv};`;
                                    pt += `f${endOv};`;
                                    zonesArr.forEach(z => { pt += `d${z.dia};n${z.num};p${z.pitch};`; });
                                    if (buegelname) pt += `s${buegelname};`;
                                    if (rezeptname) pt += `r${rezeptname};`;
                                    if (pt.endsWith(';')) pt = pt.slice(0,-1);
                                    pt += "@";
                                    const pre = head + pt + "C";
                                    const cs = calculateChecksum(pre);
                                    return pre + cs + "@";
                                };

                                let finalBvbsCode = buildCode(zonesData, anfangsueberstand, endueberstand);
                                let finalBvbsCode2 = null;
                                if (zonesData.length > 16) {
                                    const firstZones = zonesData.slice(0,16);
                                    const secondZones = zonesData.slice(16);
                                    finalBvbsCode = buildCode(firstZones, anfangsueberstand, 0);
                                    finalBvbsCode2 = buildCode(secondZones, zonesData[15].pitch, endueberstand);
                                    document.getElementById('outputBvbsCode').value = finalBvbsCode + "\r\n" + finalBvbsCode2 + "\r\n";
                                } else {
                                    document.getElementById('outputBvbsCode').value = finalBvbsCode + "\r\n";
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
			        document.getElementById('outputBvbsCode').value = "Fehler: " + e.message;
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
                        const buegelname = document.getElementById('buegelname').value || '-';
                        const auftrag = document.getElementById('auftrag').value || '-';
                        const gesamtlange = (document.getElementById('gesamtlange').value || '-') + ' mm';
                        const posnr = document.getElementById('posnr').value || '-';

                        const suffix = zonesData.length > 16 ? '/2' : '';

                        const fillLabel = (idSuffix) => {

                            document.getElementById('labelProjekt' + idSuffix).textContent = projekt;
                            document.getElementById('labelKommNr' + idSuffix).textContent = KommNr;
                            document.getElementById('labelBuegelname' + idSuffix).textContent = buegelname;
                            document.getElementById('labelAuftrag' + idSuffix).textContent = auftrag;
                            document.getElementById('labelGesamtlange' + idSuffix).textContent = gesamtlange;

                            document.getElementById('labelPosnr' + idSuffix).textContent = posnr + suffix;
                        };

                        fillLabel('');

                        const second = document.getElementById('printableLabel2');
                        if (second) {
                            if (zonesData.length > 16) {
                                second.style.display = 'block';

                                fillLabel('2');

                            } else {
                                second.style.display = 'none';
                            }
                        }

                        const labelImage = document.getElementById('labelBarcodeImage');
                        const labelText  = document.getElementById('labelBarcodeText');
                        const bvbsCode   = document.getElementById('outputBvbsCode').value.trim();
			
			if (barcodeSvg) {
			labelImage.src         = `data:image/svg+xml;base64,${btoa(barcodeSvg)}`;
			labelImage.style.display = 'block';
			labelText.style.display  = 'none';
			}
			else if (bvbsCode) {
			labelImage.style.display = 'none';
			labelText.textContent    = bvbsCode;
			labelText.style.display  = 'block';
			}
			else {
			labelImage.style.display = 'none';
			labelText.textContent    = '';
			labelText.style.display  = 'block';
			}
			}
			
			
			// Initial setup on page load
			document.addEventListener('DOMContentLoaded', () => {
			    initCollapsibleHeaders();
			    loadTemplatesFromFile();
			
			    // Event listeners
			    document.getElementById('addZoneButton')?.addEventListener('click', () => addZone());
                            document.getElementById('generateButton').addEventListener('click', () => {
                        generateBvbsCodeAndBarcode();
                        updateLabelPreview();
                        const codes = document.getElementById('outputBvbsCode').value.trim().split(/\r?\n/).filter(t => t);
                        if (codes.length > 0) {
                            generateBarcodeToLabel(codes[0], '');
                            if (codes.length > 1) {
                                generateBarcodeToLabel(codes[1], '2');
                            }
                        }
                        });
			
			
			
			
			    document.getElementById('copyBvbsButton')?.addEventListener('click', async () => {
			        const output = document.getElementById('outputBvbsCode').value;
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
			    document.getElementById('printLabelButton')?.addEventListener('click', () => {
			        if (document.getElementById('outputBvbsCode').value.trim() === '') {
			            showFeedback('barcodeError', 'Bitte generieren Sie zuerst den Code, um das Label zu drucken.', 'warning', 5000);
			            return;
			        }
			        window.print();
			    });
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
                        const initialCodes = document.getElementById('outputBvbsCode').value.trim().split(/\r?\n/).filter(t => t);
                        if (initialCodes.length > 0) {
                            generateBarcodeToLabel(initialCodes[0], '');
                            if (initialCodes.length > 1) {
                                generateBarcodeToLabel(initialCodes[1], '2');
                            }
                        }
			
			    // Set initial zones if none are loaded
			    if (zonesData.length === 0) {
			        const initialZones = [{
			            id: nextZoneId++,
			            dia: 8,
			            num: 3,
			            pitch: 150
			        }, {
			            id: nextZoneId++,
			            dia: 8,
			            num: 2,
			            pitch: 150
			        }, {
			            id: nextZoneId++,
			            dia: 8,
			            num: 3,
			            pitch: 150
			        }];
			        zonesData = initialZones;
			    }
			
			    renderAllZones();
			    drawCagePreview();
			    // 1) Label mit Feldern befüllen
			    updateLabelPreview();
			    // 2) echten Barcode erzeugen (SVG im PDF417‑Card und Canvas im Label)
			    generateBvbsCodeAndBarcode();
			
			    
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
			scaleX:      2,           // breit
			scaleY:      3,           // hoch
			height:      10,          // Stirrup‑Höhe
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
			
			
