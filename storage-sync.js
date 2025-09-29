(function () {
    const STORAGE_CONFIG = {
        bf2dSavedForms: {
            event: 'bf2dSavedFormsUpdated',
            getNames: value => Object.keys(value || {})
        },
        bf3dSavedForms: {},
        bf3dSavedShapes: {},
        bfmaSavedMeshes: {
            event: 'bfmaSavedMeshesUpdated',
            getNames: value => Object.keys(value || {})
        }
    };

    const API_ENDPOINT = '/api/bending-forms/storage';

    let snapshotPromise = null;
    let snapshotLoaded = false;

    function dispatchStorageEvent(key, value) {
        if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') {
            return;
        }
        const config = STORAGE_CONFIG[key];
        if (!config || !config.event) {
            return;
        }
        try {
            const detail = { key };
            if (typeof config.getNames === 'function') {
                try {
                    detail.names = config.getNames(value);
                } catch (error) {
                    detail.names = [];
                }
            }
            window.dispatchEvent(new CustomEvent(config.event, { detail }));
        } catch (error) {
            console.warn('Failed to dispatch storage sync event', error);
        }
    }

    function setLocalStorageKey(key, value) {
        if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
            dispatchStorageEvent(key, value);
            return;
        }
        try {
            if (value === null || value === undefined) {
                window.localStorage.removeItem(key);
            } else {
                window.localStorage.setItem(key, JSON.stringify(value));
            }
        } catch (error) {
            console.warn(`Failed to update localStorage for ${key}`, error);
        }
        dispatchStorageEvent(key, value);
    }

    async function loadSnapshot() {
        if (snapshotLoaded) {
            return;
        }
        if (snapshotPromise) {
            return snapshotPromise;
        }
        snapshotPromise = fetch(API_ENDPOINT, {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            }
        })
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Failed to load storage snapshot: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                if (!data || !Array.isArray(data.entries)) {
                    return;
                }
                data.entries.forEach(entry => {
                    if (!entry || typeof entry.key !== 'string') {
                        return;
                    }
                    if (!Object.prototype.hasOwnProperty.call(STORAGE_CONFIG, entry.key)) {
                        return;
                    }
                    setLocalStorageKey(entry.key, entry.value ?? null);
                });
            })
            .catch(error => {
                console.error('Failed to load bending form storage snapshot', error);
            })
            .finally(() => {
                snapshotLoaded = true;
            });
        return snapshotPromise;
    }

    async function pushUpdate(key, value) {
        const payload = {
            data: {
                [key]: value
            }
        };
        try {
            const response = await fetch(API_ENDPOINT, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(payload)
            });
            if (!response.ok) {
                throw new Error(`Failed to persist storage snapshot: ${response.status}`);
            }
            const data = await response.json();
            if (!data || !Array.isArray(data.entries)) {
                return;
            }
            const entry = data.entries.find(item => item && item.key === key);
            if (entry) {
                setLocalStorageKey(entry.key, entry.value ?? null);
            }
        } catch (error) {
            console.error('Failed to persist bending form storage snapshot', error);
        }
    }

    function normalizeValueForSync(value) {
        if (value === null || value === undefined) {
            return null;
        }
        if (typeof value !== 'object') {
            return value;
        }
        if (Array.isArray(value)) {
            return value;
        }
        const entries = Object.keys(value);
        if (entries.length === 0) {
            return null;
        }
        return value;
    }

    window.bendingFormStorageSync = {
        syncKey(key, value) {
            if (!Object.prototype.hasOwnProperty.call(STORAGE_CONFIG, key)) {
                return Promise.resolve(false);
            }
            const normalized = normalizeValueForSync(value);
            return pushUpdate(key, normalized);
        },
        ensureSnapshotLoaded() {
            return loadSnapshot();
        }
    };

    loadSnapshot();
})();
