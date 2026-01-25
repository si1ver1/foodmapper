document.addEventListener('DOMContentLoaded', () => {
    console.log("FoodMapper App v8 Loaded");

    // --- Security Helper ---
    function escapeHtml(text) {
        if (!text) return text;
        return String(text)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // --- Authentication & Sharing State ---
    let token = localStorage.getItem('access_token');

    // --- Check for OAuth Redirect Token ---
    const hash = window.location.hash;
    if (hash && hash.includes('access_token=')) {
        const params = new URLSearchParams(hash.substring(1));
        const accessToken = params.get('access_token');
        if (accessToken) {
            token = accessToken; // Update variable immediately
            localStorage.setItem('access_token', accessToken);
            // Clean URL
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }
    const pathParts = window.location.pathname.split('/');
    const isSharedView = pathParts[1] === 'share';
    const sharedToken = isSharedView ? pathParts[2] : null;

    // Dom Elements that need hiding in shared mode
    const addBtn = document.getElementById('add-btn');
    const btnManageCuisines = document.getElementById('btn-manage-cuisines');
    const btnManageGroups = document.getElementById('btn-manage-groups');
    const logoutBtn = document.getElementById('logout-btn');
    const loginBtn = document.getElementById('login-btn');

    function parseJwt(token) {
        var base64Url = token.split('.')[1];
        var base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        var jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function (c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        return JSON.parse(jsonPayload);
    }

    if (!token && !isSharedView) {
        window.location.href = '/static/login.html';
        return;
    }

    if (token) {
        try {
            const user = parseJwt(token);
            const userDisplay = document.getElementById('user-display');
            if (userDisplay && user.sub) {
                userDisplay.textContent = `Hi, ${user.sub}`;
                userDisplay.classList.remove('hidden');
            }
        } catch (e) {
            console.error("Invalid token", e);
        }
    }

    if (isSharedView) {
        // Read-Only Mode UI Adjustments
        document.body.classList.add('read-only-mode');
        if (addBtn) addBtn.style.display = 'none';
        if (btnManageCuisines) btnManageCuisines.style.display = 'none';
        if (btnManageGroups) btnManageGroups.style.display = 'none';
        if (logoutBtn) logoutBtn.style.display = 'none'; // Hide by default, re-enable if token exists below
    }

    async function authFetch(url, options = {}) {
        if (isSharedView && options.method && options.method !== 'GET') {
            alert("View Only Mode");
            return { ok: false };
        }

        const headers = options.headers || {};
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const res = await fetch(url, { ...options, headers });

        if (res.status === 401) {
            localStorage.removeItem('access_token');
            window.location.href = '/static/login.html';
            return res;
        }
        return res;
    }

    // --- State & Variables ---
    let map;
    let markers = {}; // id -> marker
    let restaurants = [];
    let cuisines = [];
    let groups = [];
    const tileLayerUrl = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
    let currentTileLayer;
    let userLocation = null;
    let editingId = null; // Track if we are editing
    let selectedId = null; // Track selected restaurant

    // Logout Logic
    // logoutBtn defined at top (line 27)
    // Auth Layout Logic
    if (token) {
        if (logoutBtn) { logoutBtn.classList.remove('hidden'); logoutBtn.style.display = ''; }
        if (loginBtn) loginBtn.classList.add('hidden');
    } else {
        if (logoutBtn) { logoutBtn.classList.add('hidden'); logoutBtn.style.display = 'none'; }
        if (loginBtn) loginBtn.classList.remove('hidden');
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            localStorage.removeItem('access_token');
            window.location.href = '/static/login.html';
        });
    }
    if (loginBtn) {
        loginBtn.addEventListener('click', () => {
            window.location.href = '/static/login.html';
        });
    }

    // Icon Factory for DivIcon (Allows separate animation of pin vs shadow)
    function createDivIcon(color) {
        const markerUrl = color === 'green'
            ? 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png'
            : 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png';

        return L.divIcon({
            className: 'bg-transparent border-0', // Remove default styles
            html: `
                <div class="relative w-full h-full">
                    <img src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png" 
                         class="absolute top-0 left-0" 
                         style="width: 41px; height: 41px; margin-left: 0; max-width: none;">
                    <img src="${markerUrl}" 
                         class="absolute top-0 left-0 w-full h-full marker-pin" 
                         style="max-width: none;">
                </div>
            `,
            iconSize: [25, 41],
            iconAnchor: [12, 41],
            popupAnchor: [1, -34]
        });
    }

    const blueIcon = createDivIcon('blue');
    const greenIcon = createDivIcon('green');

    // --- DOM Elements ---
    const listContainer = document.getElementById('restaurant-list');
    const cuisineFilter = document.getElementById('filter-cuisine');
    const ratingFilter = document.getElementById('filter-rating');
    const priceFilter = document.getElementById('filter-price');
    const statusFilter = document.getElementById('filter-status');
    const groupFilter = document.getElementById('filter-group');
    const themeToggle = document.getElementById('theme-toggle');
    const body = document.body;

    // Modal & Form
    const modal = document.getElementById('modal-overlay');
    const modalTitle = document.getElementById('modal-title');
    const modalContent = modal.querySelector('.modal-anim'); // for animation
    // addBtn defined at top
    const closeModalBtn = document.getElementById('modal-close');
    const addForm = document.getElementById('add-form');
    const searchInput = document.getElementById('search-input');
    const searchBtn = document.getElementById('search-btn');
    if (searchBtn) searchBtn.classList.add('hidden'); // Hide search button as Autocomplete is interactive
    const searchResultsList = document.getElementById('search-results');

    const toggleNewCuisine = document.getElementById('toggle-new-cuisine');
    const formCuisineNew = document.getElementById('form-cuisine-new');

    // Manage Cuisines & Groups
    // btnManageCuisines defined at top
    const modalCuisines = document.getElementById('modal-cuisines');
    const modalCuisinesClose = document.getElementById('modal-cuisines-close');
    const manageCuisinesList = document.getElementById('manage-cuisines-list');

    // btnManageGroups defined at top
    const modalGroups = document.getElementById('modal-groups');
    const modalGroupsClose = document.getElementById('modal-groups-close');
    const manageGroupsList = document.getElementById('manage-groups-list');
    const inputManageGroup = document.getElementById('manage-group-input');
    const btnAddGroup = document.getElementById('manage-group-add');

    // Help Me Choose
    const modalChoose = document.getElementById('modal-choose');
    const modalChooseClose = document.getElementById('modal-choose-close');
    const btnHelpChoose = document.getElementById('btn-help-choose');
    const btnChooseGo = document.getElementById('btn-choose-go');
    const btnChooseBack = document.getElementById('btn-choose-back');
    const chooseCuisinesContainer = document.getElementById('choose-cuisines');
    const chooseResultsList = document.getElementById('choose-results-list');
    const chooseStep1 = document.getElementById('choose-step-1');
    const chooseStep2 = document.getElementById('choose-step-2');

    // Mobile Tabs
    const tabList = document.getElementById('tab-list');
    const tabMap = document.getElementById('tab-map');
    const listView = document.getElementById('list-view');
    const mapView = document.getElementById('map-view');

    // --- Initialization ---

    function initMap() {
        // Default View (NYC)
        map = L.map('map').setView([40.7128, -74.0060], 13);

        updateMapStyle();

        // Try Geolocation
        if ("geolocation" in navigator) {
            navigator.geolocation.getCurrentPosition(position => {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;
                userLocation = { lat, lng };
                map.setView([lat, lng], 14);
                L.circleMarker([lat, lng], { radius: 8, fillColor: "#3388ff", color: "#fff", weight: 2, opacity: 1, fillOpacity: 0.8 }).addTo(map).bindPopup("You are here");
            }, () => console.log("Geolocation permission denied."));
        }
    }

    function updateMapStyle() {
        const isDark = body.classList.contains('dark');
        const tileOptions = {
            attribution: '&copy; OpenStreetMap & CartoDB',
            className: isDark ? 'dark-map-tiles' : ''
        };

        if (currentTileLayer) map.removeLayer(currentTileLayer);
        currentTileLayer = L.tileLayer(tileLayerUrl, tileOptions).addTo(map);
    }

    async function loadCuisines() {
        if (isSharedView) return;
        const res = await authFetch('/api/cuisines');
        if (res.ok) {
            cuisines = await res.json();
            renderCuisineOptions();
        }
    }

    function renderCuisineOptions() {
        // Filter dropdown (single select)
        let filterHtml = '<option value="">All Cuisines</option>';
        cuisines.forEach(c => {
            filterHtml += `<option value="${c.id}">${c.name}</option>`;
        });
        cuisineFilter.innerHTML = filterHtml;

        // Form Checkboxes (Multi-select)
        const container = document.getElementById('form-cuisines-container');
        if (container) {
            let formHtml = '';
            cuisines.forEach(c => {
                formHtml += `
                    <label class="flex items-center gap-2 text-xs p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded cursor-pointer">
                        <input type="checkbox" class="form-cuisine-check" value="${c.id}">
                        <span class="text-gray-800 dark:text-gray-200">${c.name}</span>
                    </label>
                `;
            });
            container.innerHTML = formHtml;
        }
    }


    async function loadGroups() {
        if (isSharedView) return;
        const res = await authFetch('/api/groups');
        if (res.ok) {
            groups = await res.json();
            renderGroupOptions();
        }
    }

    async function loadRestaurants() {
        listContainer.innerHTML = '<div class="text-center text-gray-500 mt-10">Loading...</div>';
        try {
            let url = '/api/restaurants';
            if (isSharedView) {
                url = `/api/share/${sharedToken}`;
            }

            const res = await authFetch(url);
            if (!res.ok) {
                if (res.status === 404 && isSharedView) {
                    listContainer.innerHTML = '<div class="text-center text-red-500 mt-10">Shared list not found.</div>';
                    return;
                }
                throw new Error('Failed to fetch');
            }
            restaurants = await res.json();
            renderRestaurants();
        } catch (e) {
            console.error(e);
            listContainer.innerHTML = '<div class="text-center text-red-500 mt-10">Error loading data.</div>';
        }
    }

    function renderGroupOptions() {
        // Filter dropdown
        if (groupFilter) {
            let filterHtml = '<option value="">All Groups</option>';
            groups.forEach(g => {
                filterHtml += `<option value="${g.id}">${g.name}</option>`;
            });
            groupFilter.innerHTML = filterHtml;
        }

        // Form Checkboxes (Multi-select)
        const container = document.getElementById('form-groups-container');
        if (container) {
            let formHtml = '';
            groups.forEach(g => {
                formHtml += `
                    <label class="flex items-center gap-2 text-xs p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded cursor-pointer">
                        <input type="checkbox" class="form-group-check" value="${g.id}">
                        <span class="text-gray-800 dark:text-gray-200">${g.name}</span>
                    </label>
                `;
            });
            container.innerHTML = formHtml;
        }
    }

    function selectRestaurant(id, shouldFly = true) {
        if (selectedId && markers[selectedId]) {
            markers[selectedId].setIcon(blueIcon);
            const prevCard = document.querySelector(`[data-card-id="${selectedId}"]`);
            if (prevCard) prevCard.classList.remove('ring-2', 'ring-blue-500');
        }

        if (!id) { selectedId = null; return; }

        selectedId = id;
        if (markers[id]) {
            markers[id].setIcon(greenIcon);
            markers[id].openPopup();
            if (shouldFly) map.flyTo(markers[id].getLatLng(), 16);

            const card = document.querySelector(`[data-card-id="${id}"]`);
            if (card) {
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                card.classList.add('ring-2', 'ring-blue-500');
            }
        }
    }

    function renderRestaurants() {
        listContainer.innerHTML = '';
        for (const id in markers) map.removeLayer(markers[id]);
        markers = {};

        if (restaurants.length === 0) {
            listContainer.innerHTML = '<div class="text-center mt-10 text-gray-400">No restaurants found.</div>';
            return;
        }

        const bounds = [];
        restaurants.forEach(r => {
            // Join cuisine names
            const cuisineNames = r.cuisines ? r.cuisines.map(c => c.name).join(', ') : '';

            const card = document.createElement('div');
            card.dataset.cardId = r.id;
            card.className = "bg-gray-50 dark:bg-gray-800 p-4 pb-12 relative rounded-lg shadow-sm border border-gray-100 dark:border-gray-700 hover:shadow-md transition cursor-pointer group";
            card.innerHTML = `
                <div class="flex justify-between items-start">
                    <h3 class="font-bold text-lg text-gray-800 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition">${escapeHtml(r.name)}</h3>
                    <span class="text-xs font-semibold px-2 py-1 rounded ${getStatusColor(r.status)}">${escapeHtml(r.status)}</span>
                </div>
                <div class="text-sm text-gray-500 dark:text-gray-400 mt-1">${escapeHtml(r.address)}</div>
                <div class="flex items-center gap-3 mt-3 text-sm">
                    ${r.rating ? `<span class="text-yellow-500"><i class="fa-solid fa-star"></i> ${r.rating}</span>` : `<span class="text-gray-400 text-xs italic">Unrated</span>`}
                    <span class="text-green-600 dark:text-green-400 font-medium">${escapeHtml(r.price_range)}</span>
                    <span class="text-gray-400 dark:text-gray-500" title="${escapeHtml(cuisineNames)}">• ${escapeHtml(cuisineNames)}</span>
                    ${r.groups && r.groups.length > 0 ? `<span class="bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-100 text-xs px-1.5 py-0.5 rounded ml-1" title="${r.groups.map(g => escapeHtml(g.name)).join(', ')}"><i class="fa-solid fa-list-ul"></i> ${r.groups.length}</span>` : ''}
                    ${(() => {
                    if (userLocation) {
                        const d = getDistanceMiles(userLocation.lat, userLocation.lng, r.latitude, r.longitude);
                        const dStr = d < 0.1 ? `${(d * 5280).toFixed(0)}ft` : `${d.toFixed(1)}mi`;
                        return `<span class="text-xs text-blue-500 font-medium ml-2">• ${dStr}</span>`;
                    }
                    return '';
                })()}
                </div>
                ${r.personal_notes ? `<div class="mt-2 text-xs text-gray-400 italic border-l-2 border-gray-300 pl-2">"${escapeHtml(r.personal_notes)}"</div>` : ''}
                
                <div class="absolute bottom-3 right-3 flex gap-2 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity">
                    ${isSharedView ? '' : `
                        <button class="edit-btn text-xs text-blue-500 hover:text-blue-700 bg-white dark:bg-gray-900 border border-blue-200 dark:border-blue-900 px-2 py-1 rounded shadow-sm" data-id="${r.id}">
                            <i class="fa-solid fa-edit"></i>
                        </button>
                        <button class="delete-btn text-xs text-red-500 hover:text-red-700 bg-white dark:bg-gray-900 border border-red-200 dark:border-red-900 px-2 py-1 rounded shadow-sm" data-id="${r.id}">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    `}
                </div>
            `;

            card.addEventListener('mouseenter', () => {
                if (markers[r.id] && selectedId !== r.id) {
                    const pin = markers[r.id].getElement().querySelector('.marker-pin');
                    if (pin) pin.classList.add('marker-bounce');
                }
            });
            card.addEventListener('mouseleave', () => {
                if (markers[r.id]) {
                    const pin = markers[r.id].getElement().querySelector('.marker-pin');
                    if (pin) pin.classList.remove('marker-bounce');
                }
            });
            card.addEventListener('click', () => {
                if (window.innerWidth < 768) activateTab('map');
                selectRestaurant(r.id, true);
            });
            if (!isSharedView) {
                card.querySelector('.edit-btn').addEventListener('click', (e) => { e.stopPropagation(); openModal(r); });
                card.querySelector('.delete-btn').addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (confirm('Are you sure you want to delete this restaurant?')) {
                        const res = await authFetch(`/api/restaurants/${r.id}`, { method: 'DELETE' });
                        if (res.ok) loadRestaurants();
                    }
                });
            }

            listContainer.appendChild(card);

            const marker = L.marker([r.latitude, r.longitude], { icon: blueIcon }).addTo(map).bindPopup(`<b>${r.name}</b><br><a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.name + ", " + r.address)}" target="_blank" class="text-blue-500 hover:underline">${r.address}</a>`);
            marker.on('click', () => selectRestaurant(r.id, false));
            marker.on('popupclose', () => { if (selectedId === r.id) selectRestaurant(null); });
            markers[r.id] = marker;
            bounds.push([r.latitude, r.longitude]);
        });
        if (bounds.length > 0) map.fitBounds(bounds, { padding: [50, 50] });
    }

    function getStatusColor(status) {
        if (status === 'Want to go') return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
        if (status === 'Visited') return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
        if (status === 'Favorite') return 'bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200';
        return 'bg-gray-100';
    }

    function getDistanceMiles(lat1, lon1, lat2, lon2) {
        const R = 3959; // Radius of the earth in miles
        const dLat = (lat2 - lat1) * (Math.PI / 180);
        const dLon = (lon2 - lon1) * (Math.PI / 180);
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    // --- Google Places Integration ---
    async function loadGooglePlaces() {
        try {
            const res = await authFetch('/api/config');
            const config = await res.json();
            if (!config.googleMapsApiKey) {
                console.error("Google Maps API Key not found.");
                return;
            }

            // Define the global bootstrap function + variable if not present
            // This is the modern "Dynamic Library Import" pattern to avoid loading=async warnings
            (g => { var h, a, k, p = "The Google Maps JavaScript API", c = "google", l = "importLibrary", q = "__ib__", m = document, b = window; b = b[c] || (b[c] = {}); var d = b.maps || (b.maps = {}), r = new Set, e = new URLSearchParams, u = () => h || (h = new Promise(async (f, n) => { await (a = m.createElement("script")); e.set("libraries", [...r] + ""); for (k in g) e.set(k.replace(/[A-Z]/g, t => "_" + t[0].toLowerCase()), g[k]); e.set("callback", c + ".maps." + q); a.src = `https://maps.${c}apis.com/maps/api/js?` + e; d[q] = f; a.onerror = () => h = n(Error(p + " could not load.")); a.nonce = m.querySelector("script[nonce]")?.nonce || ""; m.head.append(a) })); d[l] ? console.warn(p + " only loads once. Ignoring:", g) : d[l] = (f, ...n) => r.add(f) && u().then(() => d[l](f, ...n)) })({
                key: config.googleMapsApiKey,
                v: "weekly",
            });

            setupGooglePlaces();
        } catch (e) {
            console.error("Failed to load Google Maps config", e);
        }
    }

    async function setupGooglePlaces() {
        const inputContainer = document.getElementById('search-container');
        if (!inputContainer) return;

        try {
            const { Autocomplete } = await google.maps.importLibrary("places");

            // Create standard HTML input
            const input = document.createElement('input');
            input.id = "place-autocomplete-input";
            input.type = "text";
            input.placeholder = "Search for a restaurant...";
            input.className = "w-full p-2 border rounded dark:bg-gray-800 dark:border-gray-600 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 outline-none";

            // Remove old inputs
            const oldInput = document.getElementById('search-input');
            if (oldInput) oldInput.remove();
            const searchBtn = document.getElementById('search-btn');
            if (searchBtn) searchBtn.remove();

            inputContainer.appendChild(input);

            // Initialize Autocomplete
            const autocomplete = new Autocomplete(input, {
                fields: ['name', 'formatted_address', 'geometry'],
            });

            // Add Listener
            autocomplete.addListener('place_changed', () => {
                const place = autocomplete.getPlace();

                if (!place || !place.geometry) {
                    return;
                }

                const name = place.name;
                const address = place.formatted_address;
                const location = place.geometry.location;

                // Update Form
                const nameInput = document.getElementById('form-name');
                const addrInput = document.getElementById('form-address');

                if (nameInput) nameInput.value = name || '';
                if (addrInput) addrInput.value = address || '';

                const lat = location.lat();
                const lng = location.lng();

                document.getElementById('form-lat').value = lat;
                document.getElementById('form-lng').value = lng;

                // Pan Map
                if (map) {
                    map.setView([lat, lng], 16);
                    L.popup()
                        .setLatLng([lat, lng])
                        .setContent(`<b>${name}</b><br><a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name + ", " + address)}" target="_blank" class="text-blue-500 hover:underline">${address}</a>`)
                        .openOn(map);
                }
            });

        } catch (e) {
            console.error("Error loading Google Places:", e);
        }
    }



    function openModal(restaurant = null) {
        modal.classList.remove('hidden');
        setTimeout(() => {
            modalContent.classList.remove('scale-95', 'opacity-0');
            modalContent.classList.add('scale-100', 'opacity-100');
        }, 10);

        document.querySelectorAll('.form-cuisine-check').forEach(cb => cb.checked = false);

        if (restaurant) {
            editingId = restaurant.id;
            modalTitle.innerText = "Edit Restaurant";
            document.getElementById('form-name').value = restaurant.name;
            document.getElementById('form-address').value = restaurant.address;
            document.getElementById('form-lat').value = restaurant.latitude;
            document.getElementById('form-lng').value = restaurant.longitude;
            if (restaurant.rating === null) {
                document.getElementById('form-rating-none').checked = true;
                document.getElementById('form-rating').value = '';
                document.getElementById('form-rating').disabled = true;
                document.getElementById('form-rating').classList.add('opacity-50', 'cursor-not-allowed');
            } else {
                document.getElementById('form-rating-none').checked = false;
                document.getElementById('form-rating').value = restaurant.rating;
                document.getElementById('form-rating').disabled = false;
                document.getElementById('form-rating').classList.remove('opacity-50', 'cursor-not-allowed');
            }
            document.getElementById('form-price').value = restaurant.price_range;
            document.getElementById('form-notes').value = restaurant.personal_notes || '';
            document.getElementById('form-status').value = restaurant.status;

            if (restaurant.cuisines) {
                const ids = restaurant.cuisines.map(c => c.id);
                document.querySelectorAll('.form-cuisine-check').forEach(cb => {
                    if (ids.includes(parseInt(cb.value))) cb.checked = true;
                });
            }
            // Check groups
            document.querySelectorAll('.form-group-check').forEach(cb => cb.checked = false);
            if (restaurant.groups) {
                const ids = restaurant.groups.map(g => g.id);
                document.querySelectorAll('.form-group-check').forEach(cb => {
                    if (ids.includes(parseInt(cb.value))) cb.checked = true;
                });
            }
            toggleNewCuisine.innerText = 'Add new cuisine type';
            formCuisineNew.classList.add('hidden');
        } else {
            editingId = null;
            modalTitle.innerText = "Add Restaurant";
            addForm.reset();
            document.querySelectorAll('.form-group-check').forEach(cb => cb.checked = false);
            toggleNewCuisine.innerText = 'Add new cuisine type';
            formCuisineNew.classList.add('hidden');
        }
    }
    const hideModal = () => {
        modalContent.classList.remove('scale-100', 'opacity-100');
        modalContent.classList.add('scale-95', 'opacity-0');
        setTimeout(() => modal.classList.add('hidden'), 300);
    };

    cuisineFilter.addEventListener('change', loadRestaurants);
    ratingFilter.addEventListener('change', loadRestaurants);
    priceFilter.addEventListener('change', loadRestaurants);
    if (statusFilter) statusFilter.addEventListener('change', loadRestaurants);
    if (groupFilter) groupFilter.addEventListener('change', loadRestaurants);
    themeToggle.addEventListener('click', () => {
        body.classList.toggle('dark');
        updateMapStyle();
    });

    function activateTab(tab) {
        if (tab === 'list') {
            listView.classList.remove('hidden'); mapView.classList.add('hidden'); mapView.classList.remove('block');
            tabList.classList.add('text-blue-600', 'border-t-2', 'border-blue-600');
            tabMap.classList.remove('text-blue-600', 'border-t-2', 'border-blue-600');
        } else {
            listView.classList.add('hidden'); mapView.classList.remove('hidden'); mapView.classList.add('block');
            tabMap.classList.add('text-blue-600', 'border-t-2', 'border-blue-600');
            tabList.classList.remove('text-blue-600', 'border-t-2', 'border-blue-600');
            setTimeout(() => map.invalidateSize(), 100);
        }
    }
    tabList.addEventListener('click', () => activateTab('list'));
    tabMap.addEventListener('click', () => activateTab('map'));

    addBtn.addEventListener('click', () => openModal(null));
    closeModalBtn.addEventListener('click', hideModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) hideModal(); });
    // searchBtn.addEventListener('click', () => searchPlace(searchInput.value));
    // searchInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') { e.preventDefault(); searchPlace(searchInput.value); } });
    toggleNewCuisine.addEventListener('click', (e) => {
        e.preventDefault();
        formCuisineNew.classList.toggle('hidden');
        toggleNewCuisine.innerText = formCuisineNew.classList.contains('hidden') ? 'Add new cuisine type' : 'Cancel add new';
    });

    addForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        let cuisineIds = Array.from(document.querySelectorAll('.form-cuisine-check:checked')).map(cb => parseInt(cb.value));
        const newCuisineName = formCuisineNew.value.trim();
        if (!formCuisineNew.classList.contains('hidden') && newCuisineName) {
            const res = await authFetch('/api/cuisines', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newCuisineName }) });
            if (res.ok) {
                const c = await res.json();
                cuisineIds.push(c.id);
                await loadCuisines();
            }
        }
        if (cuisineIds.length === 0) { alert("Please select at least one cuisine."); return; }

        let groupIds = Array.from(document.querySelectorAll('.form-group-check:checked')).map(cb => parseInt(cb.value));

        const isUnrated = document.getElementById('form-rating-none').checked;
        const ratingVal = isUnrated ? null : parseInt(document.getElementById('form-rating').value);

        const data = {
            name: document.getElementById('form-name').value,
            address: document.getElementById('form-address').value,
            latitude: parseFloat(document.getElementById('form-lat').value),
            longitude: parseFloat(document.getElementById('form-lng').value),
            rating: ratingVal,
            price_range: document.getElementById('form-price').value,
            cuisine_ids: cuisineIds,
            group_ids: groupIds,
            personal_notes: document.getElementById('form-notes').value,
            status: document.getElementById('form-status').value
        };

        const method = editingId ? 'PUT' : 'POST';
        const url = editingId ? `/api/restaurants/${editingId}` : '/api/restaurants';
        const res = await authFetch(url, { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        if (res.ok) {
            addForm.reset();
            hideModal();
            loadRestaurants();
        } else { alert('Error saving restaurant'); }
    });

    document.getElementById('form-rating-none').addEventListener('change', (e) => {
        const ratingInput = document.getElementById('form-rating');
        if (e.target.checked) {
            ratingInput.disabled = true;
            ratingInput.classList.add('opacity-50', 'cursor-not-allowed');
            ratingInput.value = '';
        } else {
            ratingInput.disabled = false;
            ratingInput.classList.remove('opacity-50', 'cursor-not-allowed');
            ratingInput.value = 3;
        }
    });

    // --- Help Me Choose Logic ---
    // (DOM Elements moved to top)

    function openHelpMeChoose() {
        chooseStep1.classList.remove('hidden'); chooseStep2.classList.add('hidden');
        let html = '<label class="flex items-center gap-2 text-sm p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded cursor-pointer border-b mb-2 pb-2 dark:border-gray-700 font-bold"><input type="checkbox" id="choose-all-cuisines"> Select All</label>';
        cuisines.forEach(c => {
            html += `<label class="flex items-center gap-2 text-sm p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded cursor-pointer"><input type="checkbox" class="choose-cuisine" value="${c.id}">${c.name}</label>`;
        });
        chooseCuisinesContainer.innerHTML = html;

        // Add listener for select all
        setTimeout(() => {
            const selectAll = document.getElementById('choose-all-cuisines');
            if (selectAll) {
                selectAll.addEventListener('change', (e) => {
                    document.querySelectorAll('.choose-cuisine').forEach(cb => cb.checked = e.target.checked);
                });
            }
        }, 0);

        modalChoose.classList.remove('hidden');
        setTimeout(() => {
            modalChoose.querySelector('.modal-anim').classList.remove('scale-95', 'opacity-0');
            modalChoose.querySelector('.modal-anim').classList.add('scale-100', 'opacity-100');
        }, 10);
    }
    function closeHelpMeChoose() {
        const content = modalChoose.querySelector('.modal-anim');
        content.classList.remove('scale-100', 'opacity-100');
        content.classList.add('scale-95', 'opacity-0');
        setTimeout(() => modalChoose.classList.add('hidden'), 300);
    }
    async function runHelpMeChoose() {
        const selectedCuisines = Array.from(document.querySelectorAll('.choose-cuisine:checked')).map(cb => parseInt(cb.value));
        const minPrice = document.getElementById('choose-price').value;
        const minRating = document.getElementById('choose-rating').value;
        const selectedStatuses = Array.from(document.querySelectorAll('.choose-status:checked')).map(cb => cb.value);
        if (selectedCuisines.length === 0) { alert("Select a cuisine!"); return; }
        btnChooseGo.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Picking...';
        try {
            const res = await authFetch('/api/restaurants');
            let all = await res.json();
            let filtered = all.filter(r => {
                if (!r.cuisines.some(c => selectedCuisines.includes(c.id))) return false; // Multi-cuisine check
                if (!selectedStatuses.includes(r.status)) return false;
                if (minPrice && r.price_range !== minPrice) return false;
                if (minRating && r.rating < parseInt(minRating)) return false;
                return true;
            });
            for (let i = filtered.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));[filtered[i], filtered[j]] = [filtered[j], filtered[i]];
            }
            const picks = filtered.slice(0, 5);
            renderChooseResults(picks);
            chooseStep1.classList.add('hidden'); chooseStep2.classList.remove('hidden');
        } catch (e) { alert("Error fetching"); } finally { btnChooseGo.innerHTML = '<i class="fa-solid fa-dice"></i> Find Me Food!'; }
    }
    function renderChooseResults(picks) {
        if (picks.length === 0) {
            chooseResultsList.innerHTML = `<div class="text-center py-8 text-gray-500"><i class="fa-regular fa-face-frown text-4xl mb-2"></i><p>No matches.</p><button id="btn-try-again" class="mt-4 text-blue-500 underline">Try again</button></div>`;
            setTimeout(() => document.getElementById('btn-try-again').onclick = () => { chooseStep2.classList.add('hidden'); chooseStep1.classList.remove('hidden'); }, 0);
            return;
        }
        let html = '';
        picks.forEach(r => {
            html += `<div class="bg-gray-50 dark:bg-gray-800 p-3 rounded-lg border border-gray-200 dark:border-gray-700 flex justify-between items-center cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition group" onclick="selectChosenRestaurant(${r.id})"><div><h4 class="font-bold text-gray-800 dark:text-gray-100 group-hover:text-blue-600">${escapeHtml(r.name)}</h4><div class="text-xs text-gray-500">${r.cuisines.map(c => escapeHtml(c.name)).join(', ')} • ${escapeHtml(r.price_range)} • ${r.rating ? `<span class="text-yellow-500"><i class="fa-solid fa-star"></i> ${r.rating}</span>` : `<span class="text-gray-400 italic">Unrated</span>`}</div></div><div class="text-gray-400 group-hover:text-blue-500"><i class="fa-solid fa-chevron-right"></i></div></div>`;
        });
        chooseResultsList.innerHTML = html;
        window.selectChosenRestaurant = (id) => { closeHelpMeChoose(); selectRestaurant(id, true); if (window.innerWidth < 768) activateTab('map'); };
    }
    btnHelpChoose.addEventListener('click', openHelpMeChoose);
    modalChooseClose.addEventListener('click', closeHelpMeChoose);
    modalChoose.addEventListener('click', (e) => { if (e.target === modalChoose) closeHelpMeChoose(); });
    btnChooseGo.addEventListener('click', runHelpMeChoose);
    btnChooseBack.addEventListener('click', () => { chooseStep2.classList.add('hidden'); chooseStep1.classList.remove('hidden'); });

    // --- Manage Cuisines ---
    // (DOM Elements moved to top)

    function openManageCuisines() {
        renderManageCuisines();
        modalCuisines.classList.remove('hidden');
        setTimeout(() => { modalCuisines.querySelector('.modal-anim').classList.remove('scale-95', 'opacity-0'); modalCuisines.querySelector('.modal-anim').classList.add('scale-100', 'opacity-100'); }, 10);
    }
    function closeManageCuisines() {
        const content = modalCuisines.querySelector('.modal-anim'); content.classList.remove('scale-100', 'opacity-100'); content.classList.add('scale-95', 'opacity-0'); setTimeout(() => modalCuisines.classList.add('hidden'), 300);
    }
    function renderManageCuisines() {
        if (cuisines.length === 0) { manageCuisinesList.innerHTML = '<li class="p-4 text-center text-gray-400">No cuisines.</li>'; return; }
        let html = '';
        cuisines.forEach(c => { html += `<li class="p-3 flex justify-between items-center hover:bg-gray-50 dark:hover:bg-gray-800 transition"><span class="text-sm font-medium text-gray-800 dark:text-gray-200">${escapeHtml(c.name)}</span><button class="delete-cuisine-btn text-gray-300 hover:text-red-500 transition" data-id="${c.id}"><i class="fa-solid fa-trash-can"></i></button></li>`; });
        manageCuisinesList.innerHTML = html;
        manageCuisinesList.querySelectorAll('.delete-cuisine-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const id = btn.dataset.id;
                if (!confirm(`Delete this cuisine?`)) return;
                try {
                    const res = await authFetch(`/api/cuisines/${id}`, { method: 'DELETE' });
                    if (res.ok) { await loadCuisines(); await loadRestaurants(); renderManageCuisines(); }
                    else { const err = await res.json(); alert(err.detail || 'Error'); }
                } catch (e) { alert('Network error'); }
            });
        });
    }
    if (btnManageCuisines) btnManageCuisines.addEventListener('click', openManageCuisines);
    modalCuisinesClose.addEventListener('click', closeManageCuisines);
    modalCuisines.addEventListener('click', (e) => { if (e.target === modalCuisines) closeManageCuisines(); });

    // --- Manage Groups ---
    // (DOM Elements moved to top)

    function openManageGroups() {
        renderManageGroups();
        modalGroups.classList.remove('hidden');
        setTimeout(() => { modalGroups.querySelector('.modal-anim').classList.remove('scale-95', 'opacity-0'); modalGroups.querySelector('.modal-anim').classList.add('scale-100', 'opacity-100'); }, 10);
    }
    function closeManageGroups() {
        const content = modalGroups.querySelector('.modal-anim'); content.classList.remove('scale-100', 'opacity-100'); content.classList.add('scale-95', 'opacity-0'); setTimeout(() => modalGroups.classList.add('hidden'), 300);
    }
    function renderManageGroups() {
        if (groups.length === 0) { manageGroupsList.innerHTML = '<li class="p-4 text-center text-gray-400">No groups.</li>'; return; }
        let html = '';
        groups.forEach(g => {
            html += `
                <li class="p-3 flex justify-between items-center hover:bg-gray-50 dark:hover:bg-gray-800 transition">
                    <span class="text-sm font-medium text-gray-800 dark:text-gray-200">${escapeHtml(g.name)}</span>
                    <div class="flex gap-2">
                        <button class="share-group-btn text-blue-400 hover:text-blue-600 transition" data-id="${g.id}" title="Share Group">
                            <i class="fa-solid fa-share-nodes"></i>
                        </button>
                        <button class="delete-group-btn text-gray-300 hover:text-red-500 transition" data-id="${g.id}">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                    </div>
                </li>`;
        });
        manageGroupsList.innerHTML = html;

        // Listeners
        manageGroupsList.querySelectorAll('.delete-group-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const id = btn.dataset.id;
                if (!confirm(`Delete this group?`)) return;
                try {
                    const res = await authFetch(`/api/groups/${id}`, { method: 'DELETE' });
                    if (res.ok) { await loadGroups(); await loadRestaurants(); renderManageGroups(); }
                    else { const err = await res.json(); alert(err.detail || 'Error'); }
                } catch (e) { alert('Network error'); }
            });
        });

        manageGroupsList.querySelectorAll('.share-group-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const id = btn.dataset.id;
                try {
                    // Generate Token
                    const res = await authFetch(`/api/groups/${id}/share`, { method: 'POST' });
                    if (res.ok) {
                        const data = await res.json();
                        const url = `${window.location.origin}/share/${data.share_token}`;
                        prompt("Copy this link to share:", url);
                    } else {
                        alert("Error generating share link");
                    }
                } catch (e) { alert('Network error'); }
            });
        });
    }
    async function addGroup() {
        const name = inputManageGroup.value.trim();
        if (!name) return;
        const res = await authFetch('/api/groups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
        if (res.ok) { inputManageGroup.value = ''; await loadGroups(); renderManageGroups(); }
    }

    if (btnManageGroups) btnManageGroups.addEventListener('click', openManageGroups);
    if (modalGroupsClose) modalGroupsClose.addEventListener('click', closeManageGroups);
    if (modalGroups) modalGroups.addEventListener('click', (e) => { if (e.target === modalGroups) closeManageGroups(); });
    if (btnAddGroup) btnAddGroup.addEventListener('click', addGroup);

    // Boot
    initMap();
    if (!isSharedView) {
        loadCuisines();
        loadGroups();
        loadGooglePlaces();
    }
    loadRestaurants();
});
