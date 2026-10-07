    let unitCount = 0;
    let flightCount = 0;
    let isParsing = false;
    let currentFlights = [];
    let currentFinalText = '';
    let currentMarkup = 0;
    let currentServiceCharge = 0;
    let currentGST = 0;
    let activeBillingType = 'passenger';
    let allCustomers = [];
    let currentTripType = 'one_way';
    let unitFlightCounts = {}; // Track flight count per unit for multi-city
    let unitFlights = {}; // Store flights organized by unit
    let isGlobalEditMode = false; // Track if we're in edit mode for fare cards
    let hasUnsavedFareChanges = false; // Track if there are unsaved fare changes
    let billingAccounts = [];
    let savePassengers = []; // Temporary list of passengers to be saved with itinerary
    let saveWizardStep = 1;
    let pendingCabinSelections = {};

    function normalizeUnitIdValue(value) {
      if (value === null || value === undefined || value === '') return '1';
      return String(value);
    }

    function buildOrderedUnitFlightMap(totalFlights) {
      const orderedMap = {};
      let cursor = 0;

      Object.entries(unitFlights || {}).forEach(([unitId, flightIds]) => {
        const normalizedUnitId = normalizeUnitIdValue(unitId);
        const count = Array.isArray(flightIds) ? flightIds.length : 0;
        orderedMap[normalizedUnitId] = [];
        for (let i = 0; i < count && cursor < totalFlights; i++) {
          orderedMap[normalizedUnitId].push(cursor);
          cursor += 1;
        }
      });

      while (cursor < totalFlights) {
        if (!orderedMap['1']) orderedMap['1'] = [];
        orderedMap['1'].push(cursor);
        cursor += 1;
      }

      return orderedMap;
    }

    function applyUnitMetadataToFlights(flights) {
      if (!Array.isArray(flights) || flights.length === 0) return [];

      const normalizedFlights = flights.map(f => (f && typeof f === 'object') ? { ...f } : f);
      const orderedUnitMap = buildOrderedUnitFlightMap(normalizedFlights.length);

      Object.entries(orderedUnitMap).forEach(([unitId, indices]) => {
        indices.forEach(idx => {
          if (!normalizedFlights[idx] || typeof normalizedFlights[idx] !== 'object') return;
          normalizedFlights[idx].unit_id = unitId;
          normalizedFlights[idx].unitId = unitId;
        });
      });

      normalizedFlights.forEach((flight, idx) => {
        if (!flight || typeof flight !== 'object') return;
        const fallbackUnitId = normalizeUnitIdValue(flight.unit_id || flight.unitId || '1');
        if (!flight.unit_id && !flight.unitId) {
          flight.unit_id = fallbackUnitId;
          flight.unitId = fallbackUnitId;
        }
      });

      return normalizedFlights;
    }
    let activeCabinEditorFlights = new Set();
    window.__cardsRenderReady = false;

    function getRenderPreviewToken() {
      return new URLSearchParams(window.location.search).get('render_preview_token');
    }

    function isRenderPreviewMode() {
      return !!getRenderPreviewToken();
    }

    function getCardsCaptureMetrics(cardsContainer) {
      if (!cardsContainer) {
        return { width: null, height: null, childCount: 0 };
      }
      const children = Array.from(cardsContainer.children || []).filter(Boolean);
      if (children.length === 1) {
        const rect = children[0].getBoundingClientRect();
        return {
          width: Math.ceil(rect.width),
          height: Math.ceil(rect.height),
          childCount: 1
        };
      }
      const rect = cardsContainer.getBoundingClientRect();
      return {
        width: Math.ceil(rect.width),
        height: Math.ceil(rect.height),
        childCount: children.length
      };
    }

    function getCardsCaptureTarget(cardsContainer) {
      if (!cardsContainer) return null;
      const children = Array.from(cardsContainer.children || []).filter(Boolean);
      return children.length === 1 ? children[0] : cardsContainer;
    }

    function createCardsSnapshotHtml(mode = 'current') {
      const cardsContainer = document.getElementById('cards');
      if (!cardsContainer) return '';
      const clone = cardsContainer.cloneNode(true);
      clone.style.width = 'fit-content';
      clone.style.maxWidth = 'none';
      clone.style.display = 'inline-grid';
      clone.style.justifyContent = 'start';
      clone.style.alignItems = 'start';
      clone.style.margin = '0';
      clone.style.padding = '0';
      Array.from(clone.children || []).forEach((node) => {
        node.style.width = 'auto';
        node.style.maxWidth = 'none';
      });
      const timelines = Array.from(clone.querySelectorAll('.flight-timeline-container'));
      const arrows = Array.from(clone.querySelectorAll('.expand-icon'));

      if (mode === 'collapsed') {
        timelines.forEach((node) => { node.style.display = 'none'; });
        arrows.forEach((node) => node.classList.remove('rotated'));
      } else if (mode === 'expanded') {
        timelines.forEach((node) => { node.style.display = 'block'; });
        arrows.forEach((node) => node.classList.add('rotated'));
      }

      return inlineFlightAssetMarkup(clone.outerHTML);
    }

    async function applyRenderPreviewState(expandedIndices = []) {
      document.body.classList.add('render-preview-mode');
      const flightInputs = document.getElementById('flightInputsSection');
      const outputSection = document.getElementById('outputSection');
      const cardsSection = document.getElementById('cardsSection');
      const cards = document.getElementById('cards');
      const header = document.querySelector('.hero-section');
      const sidebar = document.getElementById('sidebar');
      const sidebarOverlay = document.getElementById('sidebarOverlay');
      const menuToggle = document.getElementById('menuToggle');
      const particles = document.getElementById('tsparticles');

      if (flightInputs) flightInputs.style.display = 'none';
      if (outputSection) outputSection.style.display = 'none';
      if (header) header.style.display = 'none';
      if (sidebar) sidebar.style.display = 'none';
      if (sidebarOverlay) sidebarOverlay.style.display = 'none';
      if (menuToggle) menuToggle.style.display = 'none';
      if (particles) particles.style.display = 'none';
      if (cardsSection) {
        cardsSection.style.display = 'block';
        cardsSection.style.margin = '0';
        cardsSection.style.padding = '0';
        cardsSection.style.width = 'fit-content';
        cardsSection.style.maxWidth = 'none';
      }
      if (cards) {
        cards.style.width = 'fit-content';
        cards.style.maxWidth = 'none';
        cards.style.display = 'inline-grid';
        cards.style.justifyContent = 'start';
        cards.style.alignItems = 'start';
        const cardWrappers = Array.from(cards.children || []).filter(Boolean);
        cardWrappers.forEach((node) => {
          node.style.width = 'auto';
          node.style.maxWidth = 'none';
        });
        if (cardWrappers.length <= 1) {
          cards.style.gridTemplateColumns = 'minmax(0, 1fr)';
        }
      }

      const expandedSet = new Set((expandedIndices || []).map(Number));
      document.querySelectorAll('.flight-timeline-container').forEach((node) => {
        const flightIndex = Number(node.dataset.flightIndex);
        const shouldExpand = expandedSet.has(flightIndex);
        node.style.display = shouldExpand ? 'block' : 'none';
        const summary = node.previousElementSibling;
        const arrow = summary ? summary.querySelector('.expand-icon') : null;
        if (arrow) arrow.classList.toggle('rotated', shouldExpand);
      });

      await new Promise((resolve) => requestAnimationFrame(resolve));
      await new Promise((resolve) => requestAnimationFrame(resolve));
      window.__cardsRenderReady = true;
    }

    async function initializeRenderPreview() {
      const token = getRenderPreviewToken();
      if (!token) return false;
      const response = await fetch(`/api/render/cards-preview/${token}`);
      if (!response.ok) {
        throw new Error('Preview payload unavailable');
      }
      const preview = await response.json();
      if (preview.theme) {
        document.documentElement.setAttribute('data-theme', preview.theme);
      }
      if (preview.cards_html) {
        const cardsSection = document.getElementById('cardsSection');
        const cardsContainer = document.getElementById('cards');
        const template = document.createElement('template');
        template.innerHTML = preview.cards_html.trim();
        const previewCards = template.content.firstElementChild;
        if (!previewCards || previewCards.id !== 'cards') {
          throw new Error('Invalid preview card markup');
        }
        if (cardsSection) cardsSection.style.display = 'block';
        if (cardsContainer) {
          cardsContainer.replaceWith(previewCards);
        }
      } else {
        currentTripType = preview.trip_type || 'one_way';
        unitFlights = preview.unit_flights || {};
        currentFlights = applyUnitMetadataToFlights(preview.flights || []);
        renderResults(currentFlights);
      }
      await applyRenderPreviewState(preview.expanded_indices || []);
      return true;
    }

    // Check authentication status on load
    window.addEventListener('DOMContentLoaded', async () => {
      const urlParams = new URLSearchParams(window.location.search);
      if (isRenderPreviewMode()) {
        try {
          await initializeRenderPreview();
        } catch (error) {
          console.error('Render preview init failed', error);
        }
        return;
      }
      await checkAuth();
      initializeTripType();
      initializeDarkMode();
      initializeSidebar();

      // ONLY Load draft if explicitly requested (e.g. after login redirect)
      if (urlParams.get('restore') === '1') {
        setTimeout(loadDraft, 500);
      }

      // Check for edit mode from itinerary
      const editId = urlParams.get('edit');
      if (editId) {
        await loadItineraryForEdit(editId);
      }

      // Close modals when clicking outside (on overlay)
      window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-overlay')) {
          const overlayId = e.target.id;
          if (overlayId === 'saveModal') {
            closeSaveModal();
          } else if (overlayId === 'loginRequiredModal') {
            closeLoginRequiredModal();
          } else {
            // General fallback
            e.target.classList.remove('active');
            e.target.classList.remove('is-active');
            e.target.style.display = 'none';
          }
        }
      });
    });

    let editingItineraryId = null; // Track if we're editing an existing itinerary

    async function loadItineraryForEdit(id) {
      try {
        const r = await fetch('/api/v2/itineraries/' + id);
        if (!r.ok) { showNotification('Failed to load itinerary for editing', 'error'); return; }
        const it = await r.json();
        editingItineraryId = id;
        const modalEl = document.getElementById('saveModal');
        if (modalEl) modalEl.dataset.currentlyEditingId = id;

        // Restore trip type mode using radio buttons
        const tripType = it.trip_type || 'one_way';
        const radio = document.querySelector(`input[name="tripType"][value="${tripType}"]`);
        if (radio) {
          radio.checked = true;
          handleTripType(); // This rebuilds input UI (Unit 1) and resets unitFlights
        }

        // Reconstruct Units (Add missing units)
        // Reconstruct Units (Add missing units and cities)
        // Group flights by unit_id to determine structure
        const flightsByUnit = {};
        const savedUnitFlights = it.raw_input_data && it.raw_input_data.unit_flights;
        if (savedUnitFlights && typeof savedUnitFlights === 'object') {
          Object.entries(savedUnitFlights).forEach(([uid, indices]) => {
            flightsByUnit[uid] = (indices || []).map(idx => (it.flights || [])[idx]).filter(Boolean);
          });
        } else {
          (it.flights || []).forEach(f => {
            const uid = normalizeUnitIdValue(f.unit_id || f.unitId || 1);
            if (!flightsByUnit[uid]) flightsByUnit[uid] = [];
            flightsByUnit[uid].push(f);
          });
        }

        const unitIds = Object.keys(flightsByUnit).sort((a, b) => parseInt(a) - parseInt(b));
        const neededUnits = unitIds.length || 1;

        // Create Units (Options)
        for (let i = 1; i < neededUnits; i++) {
          addUnit();
        }

        // For Multi-City, add cities to each unit if needed
        if (tripType === 'multi_city') {
          unitIds.forEach((uid, idx) => {
            const flightCount = flightsByUnit[uid].length;
            // Assuming units are recreated sequentially: index 0 -> Unit 1, index 1 -> Unit 2
            const domUnitId = idx + 1;

            // Add extra cities (first one exists by default)
            for (let k = 1; k < flightCount; k++) {
              addCityToUnit(domUnitId);
            }
          });
        }

        // Restore raw input texts to textareas if available
        if (it.raw_input_data && it.raw_input_data.flight_texts) {
          const textareas = document.querySelectorAll('#flightInputs textarea');
          it.raw_input_data.flight_texts.forEach((text, idx) => {
            if (textareas[idx]) textareas[idx].value = text;
          });
        }
        // Restore Fare Types in the Input Panel based on flights
        if (flightsByUnit) {
          unitIds.forEach((uid, idx) => {
            const domUnitId = idx + 1;
            const flightsInUnit = flightsByUnit[uid];
            if (flightsInUnit && flightsInUnit.length > 0) {
              const firstFlight = flightsInUnit[0];
              
              // Handle split fares toggle for Round Trip
              if (tripType === 'round_trip' && firstFlight.is_split) {
                const splitToggle = document.getElementById(`split-fares-toggle-${domUnitId}`);
                if (splitToggle && !splitToggle.checked) {
                  splitToggle.checked = true;
                  toggleSplitFares(domUnitId);
                }
              }

              if (firstFlight && firstFlight.fares) {
                const fareKeys = Object.keys(firstFlight.fares);
                if (fareKeys.length > 0) {
                   const fareListOut = document.getElementById(`fare-list-${domUnitId}_out`) || document.getElementById(`fare-list-${domUnitId}`);
                   if (fareListOut) {
                      fareListOut.innerHTML = '';
                      fareKeys.forEach(fk => {
                         const cabinLabels = { 'economy': 'Economy', 'premium_economy': 'Premium Economy', 'business': 'Business Class', 'first': 'First Class', 'saver': 'Saver Fare', 'corporate': 'Corporate Fare', 'sme': 'SME Fare', 'coupon': 'Coupon Fare', 'flexi': 'Flexi Fare' };
                         const label = cabinLabels[fk] || (fk.charAt(0).toUpperCase() + fk.slice(1).replace('_', ' ') + ' Fare');
                         fareListOut.insertAdjacentHTML('beforeend', createFareCard(fk, label, domUnitId, true, fareListOut.id.includes('_out') ? '_out' : ''));
                      });
                   }
                }
              }

              // Return flight fares if split
              if (tripType === 'round_trip' && firstFlight.is_split && flightsInUnit.length > 1) {
                const retFlight = flightsInUnit.find(f => f.direction === 'return' || f.is_return) || flightsInUnit[1];
                if (retFlight && retFlight.fares) {
                   const fareKeysRet = Object.keys(retFlight.fares);
                   if (fareKeysRet.length > 0) {
                      const fareListRet = document.getElementById(`fare-list-${domUnitId}_ret`);
                      if (fareListRet) {
                         fareListRet.innerHTML = '';
                         fareKeysRet.forEach(fk => {
                            const cabinLabels = { 'economy': 'Economy', 'premium_economy': 'Premium Economy', 'business': 'Business Class', 'first': 'First Class', 'saver': 'Saver Fare', 'corporate': 'Corporate Fare', 'sme': 'SME Fare', 'coupon': 'Coupon Fare', 'flexi': 'Flexi Fare' };
                            const label = cabinLabels[fk] || (fk.charAt(0).toUpperCase() + fk.slice(1).replace('_', ' ') + ' Fare');
                            fareListRet.insertAdjacentHTML('beforeend', createFareCard(fk, label, domUnitId, true, '_ret'));
                         });
                      }
                   }
                }
              }
            }
          });
        }

        // Restore flights
        if (it.flights && it.flights.length > 0) {
          currentFlights = applyUnitMetadataToFlights(it.flights);
          if (it.parser_output_text) {
            const outputEl = document.getElementById('output');
            if (outputEl) outputEl.textContent = it.parser_output_text;
            currentFinalText = it.parser_output_text;
          }
        }

        // --- Restore Save Modal Data ---
        document.getElementById('saveItineraryTitle').value = it.title || '';
        if (document.getElementById('saveReferenceNumber')) document.getElementById('saveReferenceNumber').value = it.reference_number || '';
        if (document.getElementById('saveReferenceNumber')) document.getElementById('saveReferenceNumber').value = it.reference_number || '';

        // Restore Passengers
        savePassengers = [];
        if (it.passengers_data && Array.isArray(it.passengers_data)) {
          // Map to ensure format matches what renderSavePassengers expects
          savePassengers = it.passengers_data.map(p => {
            const pid = p.passenger_id || p.id;
            const isDb = !!p.passenger_id || p.is_db === true;
            return {
              first_name: p.first_name || (p.name ? p.name.split(' ')[0] : ''),
              last_name: p.last_name || (p.name ? p.name.split(' ').slice(1).join(' ') : ''),
              email: p.email || '',
              phone: p.phone || '',
              is_db: isDb,
              id: isDb ? pid : p.id,
              passenger_id: isDb ? pid : null
            };
          });
        }
        
        renderSavePassengers();

        // Prefill Supplier
        if (it.supplier_account) {
          document.getElementById('supplierSearchInput').value = it.supplier_account.display_name;
          document.getElementById('supplierAccountSelect').value = it.supplier_account.id;
          document.getElementById('selectedSupplierName').textContent = it.supplier_account.display_name;
          document.getElementById('supplierSummary').style.display = 'flex';
        } else if (it.supplier_name) {
          showNewSupplierForm(it.supplier_name);
          document.getElementById('newSupCompany').value = it.supplier_company || '';
          document.getElementById('newSupGst').value = it.supplier_gst || '';
          document.getElementById('newSupEmail').value = it.supplier_email || '';
          document.getElementById('newSupPhone').value = it.supplier_phone || '';
          document.getElementById('newSupAddress').value = it.supplier_address || '';
        }

        // Restore Billing Account Selection
        if (it.billing_account_id && document.getElementById('billingAccountSelect')) {
          document.getElementById('billingAccountSelect').value = it.billing_account_id;
          if (it.billing_account) {
            // Restore legacy billing UI if present
            if (document.getElementById('billingSearchInput')) {
              document.getElementById('billingSearchInput').value = it.billing_account.display_name;
            }
            if (document.getElementById('selectedBillingName')) {
              document.getElementById('selectedBillingName').textContent = it.billing_account.display_name;
              if (document.getElementById('billingSummary')) {
                 document.getElementById('billingSummary').style.display = 'block';
              }
            }
            // Restore new BillingModule UI
            if (window.BillingModule && document.getElementById('flightBillingSearchInput')) {
              window.BillingModule.selectAccount(it.billing_account);
            }
          }
        }
        // --- End Restore ---

        // Update save button text for edit mode
        const saveBtnLabel = document.querySelector('.btn-save');
        if (saveBtnLabel) saveBtnLabel.innerHTML = '🔄 Update Itinerary';

        const modalTitle = document.querySelector('#saveModal .modal-title');
        if (modalTitle) modalTitle.textContent = '🔄 Update Itinerary';

        if (currentFlights && currentFlights.length > 0) { 
            renderResults(currentFlights); 
            document.getElementById('cardsSection').style.display = 'block'; 
            document.getElementById('outputSection').style.display = 'block'; 
            // If parser_output_text was present, restore it and intelligently inject the current passengers
            if (it.parser_output_text) {
                currentFinalText = it.parser_output_text;
                regenerateOutputText(true);
            }
        }
        showNotification('Itinerary loaded for editing. Make your changes and click Update.', 'info');
      } catch (e) {
        console.error('Edit load error:', e);
        showNotification('Error loading itinerary', 'error');
      }
    }

    // Dark mode functionality
    function initializeDarkMode() {
      const savedTheme = localStorage.getItem('theme') || 'light';
      updateThemeDisplay(savedTheme);

      // Add sidebar click event listener
      document.getElementById('sidebarThemeToggle').addEventListener('click', toggleDarkMode);
    }

    function toggleDarkMode() {
      const currentTheme = document.documentElement.getAttribute('data-theme');
      const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

      document.documentElement.setAttribute('data-theme', newTheme);
      localStorage.setItem('theme', newTheme);
      updateThemeDisplay(newTheme);
    }

    function updateThemeDisplay(theme) {
      document.documentElement.setAttribute('data-theme', theme);
      const toggleBtn = document.getElementById('sidebarThemeToggle');
      const text = document.getElementById('themeToggleText');
      const icon = toggleBtn.querySelector('.theme-icon-container');

      if (theme === 'dark') {
        icon.textContent = '☀️';
        text.textContent = 'Light Mode';
        toggleBtn.classList.add('active');
      } else {
        icon.textContent = '🌙';
        text.textContent = 'Dark Mode';
        toggleBtn.classList.remove('active');
      }
    }

    // Sidebar Logic
    function initializeSidebar() {
      const menuToggle = document.getElementById('menuToggle');
      const sidebarClose = document.getElementById('sidebarClose');
      const sidebarOverlay = document.getElementById('sidebarOverlay');
      const sidebar = document.getElementById('sidebar');

      menuToggle.addEventListener('click', () => {
        sidebar.classList.add('active');
        sidebarOverlay.classList.add('active');
        document.body.style.overflow = 'hidden'; // Prevent scroll
      });

      const closeSidebar = () => {
        sidebar.classList.remove('active');
        sidebarOverlay.classList.remove('active');
        document.body.style.overflow = '';
      };

      sidebarClose.addEventListener('click', closeSidebar);
      sidebarOverlay.addEventListener('click', closeSidebar);
    }

    function initializeTripType() {
      const tripType = document.querySelector('input[name="tripType"]:checked').value;
      handleTripType();
    }

    async function getSharedUserProfile({ force = false } = {}) {
      if (!force && window.__sharedUserProfile) return window.__sharedUserProfile;
      if (!force && window.__sharedUserProfilePromise) return window.__sharedUserProfilePromise;
      window.__sharedUserProfilePromise = (async () => {
        try {
          const response = await fetch('/api/user');
          if (!response.ok) return null;
          const data = await response.json();
          window.__sharedUserProfile = data;
          return data;
        } catch (error) {
          return null;
        } finally {
          window.__sharedUserProfilePromise = null;
        }
      })();
      return window.__sharedUserProfilePromise;
    }

    async function checkAuth() {
      try {
        const data = await getSharedUserProfile();
        if (data) updateAuthUI(data);
      } catch (error) {
        // Not logged in, that's ok
      }
    }

    function updateAuthUI(user) {
      const sidebarAuthBtn = document.getElementById('sidebarAuthBtn');
      const sidebarUserName = document.getElementById('sidebarUserName');
      const sidebarAvatar = document.getElementById('sidebarAvatar');

      if (user) {
        if (sidebarUserName) sidebarUserName.textContent = user.full_name || user.username || 'Guest User';
        const sidebarUserHandle = document.getElementById('sidebarUserHandle');
        if (sidebarUserHandle) sidebarUserHandle.textContent = user.username ? '@' + user.username : '';
        if (sidebarAvatar) sidebarAvatar.textContent = (user.full_name || user.username || 'U').charAt(0).toUpperCase();

        if (sidebarAuthBtn) {
          sidebarAuthBtn.textContent = '🚪 Logout';
          sidebarAuthBtn.classList.add('logout');
          sidebarAuthBtn.onclick = async () => {
            const confirmed = await showDeleteModal('Logout', 'Are you sure you want to logout?');
            if (confirmed) {
              logout();
            }
          };
        }
      }
    }

    function handleAuthClick() {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = '/login?next=' + next;
    }

    async function logout() {
      try {
        await fetch('/api/logout', { method: 'POST' });
        showNotification('Logged out successfully', 'success');
        setTimeout(() => window.location.reload(), 1000);
      } catch (error) {
        showNotification('Logout failed', 'error');
      }
    }

    let isCustomersLoaded = false;
    async function loadCustomers() {
      if (isCustomersLoaded) return;
      try {
        allCustomers = [];

        // Fetch Passengers from V2 API
        try {
          const passRes = await fetch('/api/v2/passengers');
          if (passRes.ok) {
            const passData = await passRes.json();
            if (passData.passengers) {
              passData.passengers.forEach(p => {
                allCustomers.push({
                  id: p.id,
                  name: p.full_name,
                  email: p.email,
                  phone: p.phone,
                  address: p.address_line1,
                  customer_type: 'passenger',
                  raw: p
                });
              });
            }
          }
        } catch (e) { console.error("Error fetching passengers:", e); }

        // Fetch Corporates from V2 API
        try {
          const corpRes = await fetch('/api/v2/corporates');
          if (corpRes.ok) {
            const corpData = await corpRes.json();
            if (corpData.corporates) {
              corpData.corporates.forEach(c => {
                allCustomers.push({
                  id: c.id,
                  name: c.contact_person_name || 'Contact Person',
                  company_name: c.company_name,
                  gst_number: c.gst_number,
                  email: c.contact_email,
                  phone: c.contact_phone,
                  address: c.billing_address_line1,
                  customer_type: 'corporate',
                  raw: c
                });
              });
            }
          }
        } catch (e) { console.error("Error fetching corporates:", e); }

        isCustomersLoaded = true;
        populateCustomerSelects();
      } catch (error) {
        console.log('Could not load customers:', error);
      }
    }

    function populateCustomerSelects() {
      const passengerSelect = document.getElementById('passengerCustomerSelect');
      const corporateSelect = document.getElementById('corporateCustomerSelect');

      // Clear existing options except first
      passengerSelect.innerHTML = '<option value="">Select existing passenger or enter new</option>';
      corporateSelect.innerHTML = '<option value="">Select existing corporate or enter new</option>';

      // Add customers to appropriate selects
      allCustomers.forEach(customer => {
        const option = document.createElement('option');
        option.value = customer.id;
        option.textContent = customer.customer_type === 'corporate'
          ? `${customer.company_name} (${customer.name})`
          : customer.name;

        if (customer.customer_type === 'passenger') {
          passengerSelect.appendChild(option);
        } else {
          corporateSelect.appendChild(option);
        }
      });
    }

    async function loadCustomerData(type) {
      const select = document.getElementById(`${type}CustomerSelect`);
      const customerId = select.value;

      if (!customerId) {
        clearForm(type);
        return;
      }

      const customer = allCustomers.find(c => c.id === customerId);
      if (!customer) return;

      if (type === 'passenger') {
        document.getElementById('passengerName').value = customer.name || '';
        document.getElementById('passengerEmail').value = customer.email || '';
        document.getElementById('passengerPhone').value = customer.phone || '';
        document.getElementById('passengerAddress').value = customer.address || '';

        // Fetch full passenger details including preferences & FF
        const extraInfoDiv = document.getElementById('passengerExtraInfo');
        const prefDisplay = document.getElementById('prefDisplay');
        const ffDisplay = document.getElementById('ffDisplay');

        try {
          const response = await fetch(`/api/v2/passengers/${customerId}`);
          if (response.ok) {
            const data = await response.json();

            // 1. Preferences
            let prefHtml = '';
            if (data.preferences) {
              if (data.preferences.meal_preference) {
                prefHtml += `<div><strong>Meal:</strong> ${data.preferences.meal_preference}</div>`;
              }
              if (data.preferences.seat_preference) {
                prefHtml += `<div><strong>Seat:</strong> ${data.preferences.seat_preference}</div>`;
              }
            }
            if (!prefHtml) prefHtml = '<div>No specific preferences found.</div>';
            prefDisplay.innerHTML = prefHtml;


            // 2. Frequent Flyer (Filtered by Airlines in currentFlights)
            let ffHtml = '';
            if (data.frequent_flyer_accounts && data.frequent_flyer_accounts.length > 0) {
              // Get unique airline names from currentFlights
              // Assuming currentFlights has 'airline' property which is the name
              const flightAirlines = [...new Set(currentFlights.map(f => f.airline ? f.airline.toLowerCase() : ''))];

              const relevantFF = data.frequent_flyer_accounts.filter(ff => {
                const ffAirline = ff.airline_name ? ff.airline_name.toLowerCase() : '';
                // Check if flight airline includes FF airline or vice versa
                return flightAirlines.some(fa => fa && (fa.includes(ffAirline) || ffAirline.includes(fa)));
              });

              if (relevantFF.length > 0) {
                relevantFF.forEach(ff => {
                  ffHtml += `<div style="margin-bottom: 0.25rem;">
                      <strong>${ff.airline_name}:</strong> <span style="font-family: monospace; background: var(--bg-card); padding: 2px 4px; border-radius: 4px; border: 1px solid var(--border);">${ff.frequent_flyer_number}</span> 
                      ${ff.tier_status ? `<span style="font-size: 0.75em; color: var(--primary); border: 1px solid var(--primary); padding: 0 4px; border-radius: 99px;">${ff.tier_status}</span>` : ''}
                   </div>`;
                });
              } else {
                ffHtml = '<div>No matching frequent flyer numbers for these flights.</div>';
              }
            } else {
              ffHtml = '<div>No frequent flyer accounts found.</div>';
            }
            ffDisplay.innerHTML = ffHtml;

            extraInfoDiv.style.display = 'grid'; // Show the container
          }
        } catch (e) {
          console.error("Error fetching passenger details:", e);
          extraInfoDiv.style.display = 'none';
        }

      } else {
        document.getElementById('corporateCompany').value = customer.company_name || '';
        document.getElementById('corporateName').value = customer.name || '';
        document.getElementById('corporateEmail').value = customer.email || '';
        document.getElementById('corporatePhone').value = customer.phone || '';
        document.getElementById('corporateGst').value = customer.gst_number || '';
        document.getElementById('corporateAddress').value = customer.address || '';
      }
    }

    function clearForm(type) {
      if (type === 'passenger') {
        document.getElementById('passengerName').value = '';
        document.getElementById('passengerEmail').value = '';
        document.getElementById('passengerPhone').value = '';
        document.getElementById('passengerAddress').value = '';
        document.getElementById('passengerExtraInfo').style.display = 'none';
      } else {
        document.getElementById('corporateCompany').value = '';
        document.getElementById('corporateName').value = '';
        document.getElementById('corporateEmail').value = '';
        document.getElementById('corporatePhone').value = '';
        document.getElementById('corporateGst').value = '';
        document.getElementById('corporateAddress').value = '';
      }
    }

    async function refreshCustomers() {
      await loadCustomers();
      showNotification('Customer list refreshed', 'success');
    }






    // --- Save Wizard Logic ---

    async function openSaveModal(initialStep = null) {
      // 1. Check if logged in
      try {
        const authRes = await fetch('/api/user');
        if (!authRes.ok) {
          saveDraft();
          showNotification('Login required to save itineraries. Redirecting...', 'info');
          // Add a special parameter to restore the draft when coming back
          const next = encodeURIComponent(window.location.pathname + '?restore=1&openSave=1');
          setTimeout(() => {
            window.location.href = '/login?next=' + next;
          }, 1500);
          return;
        }
      } catch (e) {
        console.error("Auth check failed:", e);
      }

      // --- Persist Data logic ---
      const hasUnsavedData = savePassengers.length > 0 ||
        document.getElementById('saveItineraryTitle').value.trim() !== '' ||
        document.getElementById('billingAccountSelect').value !== '';

      const isStartingNewSave = !editingItineraryId && !hasUnsavedData;

      if (isStartingNewSave) {
        // Only reset if it's a completely fresh save and we have no unsaved progress
        saveWizardStep = 1;
        savePassengers = [];
        document.getElementById('saveItineraryTitle').value = '';
        document.getElementById('billingAccountSelect').value = '';
        document.getElementById('billingSearchInput').value = '';
        document.getElementById('billingSummary').style.display = 'none';
        document.getElementById('newBillingForm').style.display = 'none';
        document.getElementById('savePassengerList').innerHTML = '';
        tempBillingDetails = null;
        clearSupplierSelection();
      }

      // If we are switching itineraries being edited, we MUST reset
      const lastEditedId = document.getElementById('saveModal').dataset.currentlyEditingId;
      if (editingItineraryId && editingItineraryId !== lastEditedId) {
        saveWizardStep = 1;
        savePassengers = [];
        document.getElementById('saveItineraryTitle').value = '';
        document.getElementById('billingAccountSelect').value = '';
        document.getElementById('billingSearchInput').value = '';
        document.getElementById('billingSummary').style.display = 'none';
        document.getElementById('newBillingForm').style.display = 'none';
        document.getElementById('savePassengerList').innerHTML = '';
        tempBillingDetails = null;
        clearSupplierSelection();
        document.getElementById('saveModal').dataset.currentlyEditingId = editingItineraryId;
      } else if (!editingItineraryId && lastEditedId) {
        // Transitioning from edit mode to new save
        saveWizardStep = 1;
        savePassengers = [];
        document.getElementById('saveItineraryTitle').value = '';
        document.getElementById('billingAccountSelect').value = '';
        document.getElementById('billingSearchInput').value = '';
        document.getElementById('billingSummary').style.display = 'none';
        document.getElementById('newBillingForm').style.display = 'none';
        document.getElementById('savePassengerList').innerHTML = '';
        tempBillingDetails = null;
        clearSupplierSelection();
        delete document.getElementById('saveModal').dataset.currentlyEditingId;
      }

      // Show Modal first so the UI paints before any directory fetches begin
      document.getElementById('saveModal').classList.add('active');
      if (initialStep) saveWizardStep = initialStep;
      goToStep(saveWizardStep || 1);
      await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

      // Load Data after modal is visible
      await Promise.all([loadBillingAccounts(), loadCustomers(), loadSupplierAccounts()]);

      // If editing, pre-fill saved data — but only if this is the FIRST open for this itinerary
      // (i.e., we just switched to it). If the user already loaded this itinerary and is
      // re-opening the modal, preserve their local edits (e.g., removed passengers).
      const needsPrefill = editingItineraryId && editingItineraryId !== lastEditedId;
      if (needsPrefill) {
        document.getElementById('saveModal').dataset.currentlyEditingId = editingItineraryId;
        try {
          const r = await fetch('/api/v2/itineraries/' + editingItineraryId);
          if (r.ok) {
            const it = await r.json();
            // Pre-fill title and reference
            document.getElementById('saveItineraryTitle').value = it.title || '';
            const refEl = document.getElementById('saveReferenceNumber');
            if (refEl) refEl.value = it.reference_number || '';

            // Pre-fill billing account
            if (it.billing_account_id) {
              document.getElementById('billingAccountSelect').value = it.billing_account_id;
              // Trigger visual update so user sees what's selected
              const acc = billingAccounts.find(a => a.id == it.billing_account_id);
              if (acc) {
                document.getElementById('billingSearchInput').value = acc.display_name;
                document.getElementById('selectedBillingName').textContent = acc.display_name;
                document.getElementById('selectedBillingDetails').innerHTML = `
                      ${acc.company_name ? `<div><strong>Company:</strong> ${acc.company_name}</div>` : ''}
                      ${acc.gst_number ? `<div><strong>GST:</strong> ${acc.gst_number}</div>` : ''}
                      ${acc.email ? `<div><strong>Email:</strong> ${acc.email}</div>` : ''}
                      ${acc.phone ? `<div><strong>Phone:</strong> ${acc.phone}</div>` : ''}
                  `;
                document.getElementById('billingSummary').style.display = 'block';
              }
            } else if (it.bill_to_name) {
              // Manual billing restoration
              tempBillingDetails = {
                display_name: it.bill_to_name,
                company_name: it.bill_to_company,
                address: it.bill_to_address,
                gst_number: it.bill_to_gst,
                email: it.bill_to_email,
                phone: it.bill_to_phone
              };
              renderTempBillingSummary();
              document.getElementById('billingSummary').style.display = 'block';
              document.getElementById('billingSearchInput').value = it.bill_to_name;
            }

            // Pre-fill passengers
            if (it.passengers_data && it.passengers_data.length > 0) {
              savePassengers = it.passengers_data.map(p => {
                const pid = p.passenger_id || p.id;
                const isDb = !!p.passenger_id || p.is_db === true;
                return {
                  id: isDb ? pid : p.id,
                  passenger_id: isDb ? pid : null,
                  first_name: p.first_name || (p.name ? p.name.split(' ')[0] : ''),
                  last_name: p.last_name || (p.name ? p.name.split(' ').slice(1).join(' ') : ''),
                  email: p.email,
                  phone: p.phone,
                  is_db: isDb
                };
              });
              renderSavePassengers();

              // Prefill Supplier
              if (it.supplier_account) {
                document.getElementById('supplierSearchInput').value = it.supplier_account.display_name;
                document.getElementById('supplierAccountSelect').value = it.supplier_account.id;
                document.getElementById('selectedSupplierName').textContent = it.supplier_account.display_name;

                let subText = it.supplier_account.account_type === 'corporate' ? 'Corporate' : 'Individual';
                if (it.supplier_account.company_name) subText += ` • ${it.supplier_account.company_name}`;
                if (it.supplier_account.gst_number) subText += ` • GST: ${it.supplier_account.gst_number}`;
                document.getElementById('selectedSupplierDetails').textContent = subText;

                document.getElementById('supplierSummary').style.display = 'flex';
              } else if (it.supplier_name) {
                // Manual supplier entry restoration
                tempSupplierDetails = {
                  display_name: it.supplier_name,
                  company_name: it.supplier_company,
                  email: it.supplier_email,
                  phone: it.supplier_phone,
                  gst_number: it.supplier_gst,
                  address: it.supplier_address,
                  account_type: 'corporate'
                };
                document.getElementById('supplierSearchInput').value = it.supplier_name;
                document.getElementById('selectedSupplierName').textContent = it.supplier_name;
                document.getElementById('selectedSupplierDetails').textContent = 'Manual Entry';
                document.getElementById('supplierSummary').style.display = 'flex';
              }
            }
          }
        } catch (e) { console.error('Error pre-filling edit data:', e); }
      }

      // Set modal title and button text based on editing state
      if (editingItineraryId) {
        const modalTitle = document.querySelector('#saveModal .modal-title');
        if (modalTitle) modalTitle.textContent = '🔄 Update Itinerary';
        const saveBtnText = document.getElementById('saveBtnText');
        if (saveBtnText) saveBtnText.textContent = '🔄 Update Itinerary';
      } else {
        // Ensure we show "Save" text for new itineraries
        const modalTitle = document.querySelector('#saveModal .modal-title');
        if (modalTitle) modalTitle.textContent = '💾 Save Itinerary';
        const saveBtnText = document.getElementById('saveBtnText');
        if (saveBtnText) saveBtnText.textContent = '💾 Save Itinerary';
      }

    }

    function closeSaveModal() {
      document.getElementById('saveModal').classList.remove('active');
    }

    function goToStep(step) {
      saveWizardStep = step;
      document.querySelectorAll('.save-step').forEach(el => el.style.display = 'none');
      document.querySelectorAll('.save-step').forEach(el => {
        el.style.display = 'none';
        el.style.opacity = '0';
        el.style.transform = 'translateY(5px)';
      });

      const targetStep = document.getElementById(`saveStep${step}`);
      targetStep.style.display = 'block';
      // Trigger reflow
      void targetStep.offsetWidth;
      targetStep.style.transition = 'all 0.3s ease';
      targetStep.style.opacity = '1';
      targetStep.style.transform = 'translateY(0)';

      // Update Indicators
      document.querySelectorAll('.step-indicator').forEach(el => {
        el.classList.remove('active');
        el.style.fontWeight = '500';
        el.style.color = '#94a3b8';
        el.style.borderBottom = '2px solid #eee';
        el.style.textShadow = 'none';
      });
      const activeInd = document.getElementById(`stepIndicator${step}`);
      activeInd.classList.add('active');
      activeInd.style.fontWeight = '800';
      activeInd.style.color = '#3b82f6';
      activeInd.style.borderBottom = '2px solid #3b82f6';
      activeInd.style.textShadow = 'none';
    }

    // --- Step 1: Billing ---
    let isBillingAccountsLoaded = false;
    async function loadBillingAccounts() {
      if (isBillingAccountsLoaded) return;
      try {
        const response = await fetch('/api/v2/billing-accounts');
        if (response.ok) {
          const data = await response.json();
          billingAccounts = data.billing_accounts || [];
          console.log('Loaded', billingAccounts.length, 'billing accounts');
          isBillingAccountsLoaded = true;
        }
      } catch (e) {
        console.error('Failed to load billing accounts', e);
      }
    }

    let currentBillingResults = [];

    function selectBillingRecordByIndex(idx) {
      const res = currentBillingResults[idx];
      if (!res) return;

      const resultsDiv = document.getElementById('billingSearchResults');
      const input = document.getElementById('billingSearchInput');
      const container = document.getElementById('billingSummary');
      const idInput = document.getElementById('billingAccountSelect');

      resultsDiv.style.display = 'none';
      tempBillingDetails = null;
      const raw = res.raw;

      if (res.type === 'billing') {
        idInput.value = raw.id;
        input.value = raw.display_name;
        // Ensure this account is in the global array so submitItinerary can find it
        if (!billingAccounts.find(a => a.id == raw.id)) {
          billingAccounts.push(raw);
        }
        document.getElementById('selectedBillingName').textContent = raw.display_name;
        document.getElementById('selectedBillingDetails').innerHTML = `
                ${raw.company_name ? `<div><strong>Company:</strong> ${raw.company_name}</div>` : ''}
                ${raw.gst_number ? `<div><strong>GST:</strong> ${raw.gst_number}</div>` : ''}
                ${raw.email ? `<div><strong>Email:</strong> ${raw.email}</div>` : ''}
                ${raw.phone ? `<div><strong>Phone:</strong> ${raw.phone}</div>` : ''}
          `;
      } else if (res.type === 'passenger') {
        idInput.value = '';
        input.value = raw.name;
        tempBillingDetails = {
          account_type: 'individual',
          display_name: raw.name,
          contact_name: raw.name,
          email: raw.email,
          phone: raw.phone,
          address: raw.address,
          passenger_id: raw.id
        };
        renderTempBillingSummary();
      } else if (res.type === 'corporate') {
        idInput.value = '';
        input.value = raw.company_name;
        tempBillingDetails = {
          account_type: 'corporate',
          display_name: raw.company_name,
          company_name: raw.company_name,
          contact_name: raw.name,
          email: raw.email,
          phone: raw.phone,
          address: raw.address,
          gst_number: raw.gst_number,
          corporate_id: raw.id
        };
        renderTempBillingSummary();
      }
      container.style.display = 'block';
    }

    function renderTempBillingSummary() {
      if (!tempBillingDetails) return;
      document.getElementById('selectedBillingName').textContent = tempBillingDetails.display_name;
      document.getElementById('selectedBillingDetails').innerHTML = `
            ${tempBillingDetails.company_name ? `<div><strong>Company:</strong> ${tempBillingDetails.company_name}</div>` : ''}
            ${tempBillingDetails.gst_number ? `<div><strong>GST:</strong> ${tempBillingDetails.gst_number}</div>` : ''}
            ${tempBillingDetails.email ? `<div><strong>Email:</strong> ${tempBillingDetails.email}</div>` : ''}
            ${tempBillingDetails.phone ? `<div><strong>Phone:</strong> ${tempBillingDetails.phone}</div>` : ''}
      `;
    }

    function toggleNewBillingForm() {
      const form = document.getElementById('newBillingForm');
      form.style.display = form.style.display === 'none' ? 'block' : 'none';

      // If closing, maybe clear? No, keep state.
    }

    function prepareNewBillingAccount(name) {
      if (!name) return;
      document.getElementById('billingSearchResults').style.display = 'none';

      const form = document.getElementById('newBillingForm');
      form.style.display = 'block';

      // Detect email or phone
      const isEmail = name.includes('@');
      const isPhone = /^\+?\d{7,15}$/.test(name.replace(/[\s-]/g, ''));

      if (isEmail) {
        document.getElementById('newBillEmail').value = name;
        // Extract display name from email
        const extractedName = name.split('@')[0].replace(/[._]/g, ' ');
        document.getElementById('newBillDisplay').value = extractedName;
      } else if (isPhone) {
        document.getElementById('newBillPhone').value = name;
        document.getElementById('newBillDisplay').value = ''; // Let them fill it
        document.getElementById('newBillDisplay').focus();
        document.getElementById('saveBillingToDb').checked = true;
        return; // Exit early to keep focus
      } else {
        document.getElementById('newBillDisplay').value = name;
      }

      document.getElementById('saveBillingToDb').checked = true;
      if (!document.getElementById('newBillDisplay').value) {
        document.getElementById('newBillDisplay').focus();
      } else {
        // If display name filled, focus on next logical field
        document.getElementById('newBillCompany').focus();
      }
    }

    function searchBillingUnified() {
      const originalVal = document.getElementById('billingSearchInput').value.trim();
      const q = originalVal.toLowerCase();
      const resultsDiv = document.getElementById('billingSearchResults');

      const currentId = document.getElementById('billingAccountSelect').value;
      if (currentId) {
        const acc = billingAccounts.find(a => a.id == currentId);
        if (acc && acc.display_name.toLowerCase() !== q && q.length > 0) {
          document.getElementById('billingAccountSelect').value = '';
          document.getElementById('selectedBillingName').textContent = '';
          document.getElementById('selectedBillingDetails').innerHTML = '';
          document.getElementById('billingSummary').style.display = 'none';
          tempBillingDetails = null;
        }
      }

      if (!currentId && tempBillingDetails && q.length > 0) {
        tempBillingDetails = null;
        document.getElementById('selectedBillingName').textContent = '';
        document.getElementById('selectedBillingDetails').innerHTML = '';
        document.getElementById('billingSummary').style.display = 'none';
      }

      currentBillingResults = [];

      billingAccounts.forEach(acc => {
        const displayName = (acc.display_name || '').toLowerCase();
        const companyName = (acc.company_name || '').toLowerCase();
        const emailRaw = acc.email || '';
        const phoneRaw = acc.phone || '';
        const email = emailRaw.toLowerCase();
        const phone = phoneRaw.toLowerCase();
        if (!q || displayName.includes(q) || companyName.includes(q) || email.includes(q) || phone.includes(q)) {
          const contactParts = [];
          if (emailRaw) contactParts.push(emailRaw);
          if (phoneRaw) contactParts.push(phoneRaw);
          const contact = contactParts.join(' • ');
          currentBillingResults.push({
            type: 'billing',
            id: acc.id,
            display: acc.display_name || 'Unnamed Account',
            sub: acc.company_name ? 'B2B Customer' : 'B2C Customer',
            contact: contact,
            raw: acc
          });
        }
      });

      allCustomers.forEach(c => {
        const name = (c.name || '').toLowerCase();
        const company = (c.company_name || '').toLowerCase();
        const emailRaw = c.email || c.contact_email || '';
        const phoneRaw = c.phone || c.contact_phone || '';
        const email = emailRaw.toLowerCase();
        const phone = phoneRaw.toLowerCase();
        if (!q || name.includes(q) || company.includes(q) || email.includes(q) || phone.includes(q)) {
          const contactParts = [];
          if (emailRaw) contactParts.push(emailRaw);
          if (phoneRaw) contactParts.push(phoneRaw);
          const contact = contactParts.join(' • ');
          currentBillingResults.push({
            type: c.customer_type,
            id: c.id,
            display: c.customer_type === 'corporate' ? ((c.company_name || '') + (c.name ? ' (' + c.name + ')' : '')) : (c.name || 'Unnamed Passenger'),
            sub: c.customer_type === 'corporate' ? (c.company_name ? 'B2B Customer' : 'B2C Customer') : 'B2C Customer',
            contact: contact,
            raw: c
          });
        }
      });

      let html = currentBillingResults.slice(0, 10).map((r, idx) => `
            <div class="search-item" onclick="selectBillingRecordByIndex(${idx})" 
                 style="padding:12px 15px; cursor:pointer; border-bottom:1px solid var(--border-color); display:flex; align-items:center; gap:12px; transition: background 0.2s;">
                <div class="avatar" style="width:36px; height:36px; border-radius:50%; background:#2563eb; color:white; display:flex; align-items:center; justify-content:center; font-weight:bold; flex-shrink:0; font-size:14px; box-shadow:0 2px 4px rgba(0,0,0,0.1);">
                  ${(r.display && r.display.trim().length > 0) ? r.display.trim()[0].toUpperCase() : '?'}
                </div>
                <div style="flex-grow:1; line-height:1.4;">
                  <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
                    <div style="font-weight:600; color:var(--text-primary); font-size:0.95rem;">
                      ${r.display}
                    </div>
                    <div style="font-size:0.8rem; color:var(--text-secondary); display:flex; align-items:center; gap:5px;">
                      <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${r.sub.includes('B2B') ? '#4caf50' : '#2196f3'};"></span>
                      ${r.sub}
                    </div>
                  </div>
                  ${r.contact ? `<div style="font-size:0.75rem; color:var(--text-secondary); margin-top:2px;">${r.contact}</div>` : ''}
                </div>
            </div>
        `).join('');

      if (q.length > 0) {
        html += `
            <div class="search-item" onclick="prepareNewBillingAccount('${originalVal.replace(/'/g, "\\'")}')" 
                 style="padding:12px 15px; cursor:pointer; border-bottom:1px solid var(--border-color); display:flex; align-items:center; gap:12px; transition: background 0.2s; background: rgba(37, 99, 235, 0.05); color: var(--primary);">
                <div class="avatar" style="width:36px; height:36px; border-radius:50%; background:var(--primary); color:white; display:flex; align-items:center; justify-content:center; font-weight:bold; flex-shrink:0; font-size:16px;">+</div>
                <div style="flex-grow:1; line-height:1.4;">
                  <div style="font-weight:600; font-size:0.95rem;">Create New: "${originalVal}"</div>
                  <div style="font-size:0.8rem; opacity:0.8;">Open form to add billing details</div>
                </div>
            </div>`;
      }
      if (currentBillingResults.length === 0 && q.length > 0) {
        html = '<div style="padding:15px; text-align:center; color:var(--text-secondary);">No matches found for "' + originalVal + '"</div>';
      } else if (currentBillingResults.length === 0 && q.length === 0) {
        html = '<div style="padding:15px; text-align:center; color:var(--text-secondary);">No accounts found. Create new above.</div>';
      }

      resultsDiv.innerHTML = html;
      resultsDiv.style.display = 'block';
    }

    let tempBillingDetails = null; // Store ad-hoc details

    async function useNewBillingAccount() {
      const type = document.getElementById('newBillType').value;
      const display = document.getElementById('newBillDisplay').value;
      const saveToDb = document.getElementById('saveBillingToDb').checked;

      if (!display) {
        showNotification('Display Name is required', 'error');
        return;
      }

      const payload = {
        account_type: type,
        display_name: display,
        company_name: document.getElementById('newBillCompany').value,
        contact_name: document.getElementById('newBillContact').value,
        email: document.getElementById('newBillEmail').value,
        phone: document.getElementById('newBillPhone').value,
        gst_number: document.getElementById('newBillGst').value,
        address: document.getElementById('newBillAddress').value
      };

      if (saveToDb) {
        // Create in DB and select it
        try {
          const response = await fetch('/api/v2/billing-accounts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });

          if (response.ok) {
            const result = await response.json();
            await loadBillingAccounts();
            loadSupplierAccounts();
            loadSupplierAccounts();

            // Set selection in UI
            document.getElementById('billingAccountSelect').value = result.billing_account.id;
            document.getElementById('billingSearchInput').value = result.billing_account.display_name;

            // Render Summary
            document.getElementById('selectedBillingName').textContent = result.billing_account.display_name;
            document.getElementById('selectedBillingDetails').innerHTML = `
                ${result.billing_account.company_name ? `<div>${result.billing_account.company_name}</div>` : ''}
                ${result.billing_account.gst_number ? `<div>GST: ${result.billing_account.gst_number}</div>` : ''}
                ${result.billing_account.email ? `<div>${result.billing_account.email}</div>` : ''}
            `;
            document.getElementById('billingSummary').style.display = 'block';

            toggleNewBillingForm();
            showNotification('Billing Account saved & selected', 'success');
            tempBillingDetails = null; // Clear temp as we are using a real ID
          } else {
            const err = await response.json();
            showNotification(err.error || 'Failed to create account', 'error');
          }
        } catch (e) {
          console.error(e);
          showNotification('Error creating account', 'error');
        }
      } else {
        // Ad-hoc usage
        tempBillingDetails = payload; // Store for submit step

        // Set UI to show this is selected
        document.getElementById('billingAccountSelect').value = ''; // Deselect specific account
        document.getElementById('selectedBillingName').textContent = display + " (Unsaved)";
        document.getElementById('selectedBillingDetails').innerHTML = `
                ${payload.company_name ? `<div>${payload.company_name}</div>` : ''}
                ${payload.gst_number ? `<div>GST: ${payload.gst_number}</div>` : ''}
                ${payload.email ? `<div>${payload.email}</div>` : ''}
          `;
        document.getElementById('billingSummary').style.display = 'block';

        toggleNewBillingForm();
        showNotification('Using temporary billing details', 'info');
      }
    }


    // --- Step 2: Supplier ---
    let supplierAccounts = [];
    let currentSupplierResults = [];
    let tempSupplierDetails = null;
    let isSupplierAccountsLoaded = false;

    async function loadSupplierAccounts() {
      if (isSupplierAccountsLoaded) return;
      try {
        const response = await fetch('/api/v2/supplier-accounts');
        if (response.ok) {
          const data = await response.json();
          supplierAccounts = data.supplier_accounts || [];
          isSupplierAccountsLoaded = true;
        }
      } catch (e) { console.error('Failed to load supplier accounts', e); }
    }

    function searchSupplierUnified() {
      const q = document.getElementById('supplierSearchInput').value.toLowerCase().trim();
      const resultsDiv = document.getElementById('supplierSearchResults');

      const currentId = document.getElementById('supplierAccountSelect').value;
      if (currentId) {
        const acc = supplierAccounts.find(a => a.id == currentId);
        if (acc && acc.display_name.toLowerCase() !== q && q.length > 0) {
          clearSupplierSelection(true);
        }
      }

      /* Removed early return to show results on click/focus */
      // if (q.length === 0) {
      //   resultsDiv.style.display = 'none';
      //   document.getElementById('newSupplierForm').style.display = 'none';
      //   return;
      // }

      currentSupplierResults = [];
      supplierAccounts.forEach(acc => {
        const displayName = (acc.display_name || '').toLowerCase();
        const companyName = (acc.company_name || '').toLowerCase();
        const gst = (acc.gst_number || '').toLowerCase();
        if (!q || displayName.includes(q) || companyName.includes(q) || gst.includes(q)) {
          currentSupplierResults.push({
            id: acc.id,
            display: acc.display_name,
            sub: acc.account_type === 'corporate' ? 'Corporate' : 'Individual',
            raw: acc
          });
        }
      });

      let html = currentSupplierResults.slice(0, 10).map((r, idx) => {
        return `
        <div class="dropdown-item" onclick="selectSupplierByIndex(${idx})" style="padding:10px; cursor:pointer; border-bottom:1px solid var(--border);">
          <div style="font-weight:600;">${r.display}</div>
          <div style="font-size:0.8rem; color:var(--text-secondary);">${r.sub}</div>
        </div>
        `;
      }).join('');

      if (q.length > 0) {
        html += `
        <div class="dropdown-item" style="padding:10px; cursor:pointer; background:var(--primary-light); color:var(--primary); font-weight:bold;"
             onclick="showNewSupplierForm('${q}')">
          + Create New Supplier Account: "${q}"
        </div>
      `;
      } else if (currentSupplierResults.length === 0) {
        html = '<div style="padding:15px; text-align:center; color:var(--text-secondary);">No supplier accounts found. Create new above.</div>';
      }

      resultsDiv.innerHTML = html;
      resultsDiv.style.display = 'block';
      document.getElementById('newSupplierForm').style.display = 'none';
    }

    function selectSupplierByIndex(idx) {
      const res = currentSupplierResults[idx];
      if (!res) return;

      document.getElementById('supplierSearchInput').value = res.display;
      document.getElementById('supplierSearchResults').style.display = 'none';

      document.getElementById('supplierAccountSelect').value = res.id;
      document.getElementById('selectedSupplierName').textContent = res.display;
      // Ensure this account is in the global array so submitItinerary can find it
      if (!supplierAccounts.find(a => a.id == res.id)) {
        supplierAccounts.push(res.raw);
      }

      let subText = res.sub;
      if (res.raw.company_name) subText += ` • ${res.raw.company_name}`;
      if (res.raw.gst_number) subText += ` • GST: ${res.raw.gst_number}`;
      document.getElementById('selectedSupplierDetails').textContent = subText;

      document.getElementById('supplierSummary').style.display = 'flex';
      document.getElementById('newSupplierForm').style.display = 'none';
      tempSupplierDetails = null; // Clear temp if using existing
    }

    function showNewSupplierForm(name) {
      document.getElementById('supplierSearchResults').style.display = 'none';
      document.getElementById('newSupplierForm').style.display = 'block';
      document.getElementById('supplierSummary').style.display = 'none';

      document.getElementById('newSupDisplay').value = name;
      document.getElementById('supplierAccountSelect').value = '';

      if (name.toLowerCase().includes('co') || name.toLowerCase().includes('ltd')) {
        document.getElementById('newSupType').value = 'corporate';
      } else {
        document.getElementById('newSupType').value = 'individual';
      }
      handleSupTypeChange();
    }

    function handleSupTypeChange() {
      const type = document.getElementById('newSupType').value;
      if (type === 'corporate') {
        document.getElementById('corporateSupFields').style.display = 'block';
      } else {
        document.getElementById('corporateSupFields').style.display = 'none';
        document.getElementById('newSupCompany').value = '';
        document.getElementById('newSupGst').value = '';
        document.getElementById('newSupContact').value = '';
      }
      buildTempSupplier();
    }

    function clearSupplierSelection(keepSearchStr = false) {
      if (!keepSearchStr) document.getElementById('supplierSearchInput').value = '';
      document.getElementById('supplierAccountSelect').value = '';
      document.getElementById('selectedSupplierName').textContent = '';
      document.getElementById('selectedSupplierDetails').innerHTML = '';
      document.getElementById('supplierSummary').style.display = 'none';
      tempSupplierDetails = null;
    }

    async function useNewSupplierAccount() {
      const type = document.getElementById('newSupType').value;
      const display = document.getElementById('newSupDisplay').value.trim();
      const saveToDb = document.getElementById('saveSupplierToDb').checked;

      if (!display) {
        showNotification('Display Name is required', 'error');
        return;
      }

      const payload = {
        account_type: type,
        display_name: display,
        company_name: document.getElementById('newSupCompany').value.trim(),
        contact_name: document.getElementById('newSupContact').value.trim(),
        email: document.getElementById('newSupEmail').value.trim(),
        phone: document.getElementById('newSupPhone').value.trim(),
        gst_number: document.getElementById('newSupGst').value.trim(),
        address: document.getElementById('newSupAddress').value.trim()
      };

      if (saveToDb) {
        try {
          const response = await fetch('/api/v2/supplier-accounts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });

          if (response.ok) {
            const result = await response.json();
            await loadSupplierAccounts();

            document.getElementById('supplierAccountSelect').value = result.supplier_account.id;
            document.getElementById('supplierSearchInput').value = result.supplier_account.display_name;
            document.getElementById('selectedSupplierName').textContent = result.supplier_account.display_name;
            document.getElementById('selectedSupplierDetails').textContent = (type === 'corporate' ? 'Corporate' : 'Individual') + (payload.company_name ? ' • ' + payload.company_name : '');
            document.getElementById('supplierSummary').style.display = 'flex';
            document.getElementById('newSupplierForm').style.display = 'none';
            showNotification('Supplier Account saved & selected', 'success');
            tempSupplierDetails = null;
          } else {
            const err = await response.json();
            showNotification(err.error || 'Failed to create supplier', 'error');
          }
        } catch (e) {
          console.error(e);
          showNotification('Error creating supplier', 'error');
        }
      } else {
        tempSupplierDetails = payload;
        document.getElementById('supplierAccountSelect').value = '';
        document.getElementById('selectedSupplierName').textContent = display + " (Unsaved)";
        document.getElementById('selectedSupplierDetails').textContent = (type === 'corporate' ? 'Corporate' : 'Individual');
        document.getElementById('supplierSummary').style.display = 'flex';
        document.getElementById('newSupplierForm').style.display = 'none';
        showNotification('Using temporary supplier details', 'info');
      }
    }

    function buildTempSupplier() {
      const type = document.getElementById('newSupType').value;
      const display = document.getElementById('newSupDisplay').value;
      if (!display) return;
      tempSupplierDetails = {
        account_type: type,
        display_name: display,
        company_name: document.getElementById('newSupCompany').value,
        contact_name: document.getElementById('newSupContact').value,
        email: document.getElementById('newSupEmail').value,
        phone: document.getElementById('newSupPhone').value,
        gst_number: document.getElementById('newSupGst').value,
        address: document.getElementById('newSupAddress').value
      };
    }

    ['newSupDisplay', 'newSupCompany', 'newSupContact', 'newSupEmail', 'newSupPhone', 'newSupGst', 'newSupAddress'].forEach(id => {
      const e = document.getElementById(id);
      if (e) e.addEventListener('input', buildTempSupplier);
    });

    function initSupplierListeners() {
      ['newSupDisplay', 'newSupCompany', 'newSupContact', 'newSupEmail', 'newSupPhone', 'newSupGst', 'newSupAddress'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', buildTempSupplier);
      });
    }

    // --- Step 3: Passengers ---
    // Reuse existing customer loader logic slightly or fetch new
    let allPassengersCache = [];

    function prepareNewPassenger(name) {
      if (!name) return;
      document.getElementById('savePassengerResults').style.display = 'none';

      const form = document.getElementById('quickAddPassengerForm');
      form.style.display = 'block';

      // Detect email or phone
      const isEmail = name.includes('@');
      const isPhone = /^\+?\d{7,15}$/.test(name.replace(/[\s-]/g, ''));

      // Clear previous values first
      document.getElementById('qaFirst').value = '';
      document.getElementById('qaLast').value = '';
      document.getElementById('qaEmail').value = '';
      document.getElementById('qaPhone').value = '';

      if (isEmail) {
        document.getElementById('qaEmail').value = name;
        // Suggest name from email
        const extractedName = name.split('@')[0].replace(/[._]/g, ' ');
        const parts = extractedName.split(' ');
        document.getElementById('qaFirst').value = parts[0];
        if (parts.length > 1) {
          document.getElementById('qaLast').value = parts.slice(1).join(' ');
        }
        document.getElementById('qaLast').focus();
      } else if (isPhone) {
        document.getElementById('qaPhone').value = name;
        document.getElementById('qaFirst').focus();
      } else {
        // Standard Name Input
        const parts = name.trim().split(' ');
        const first = parts[0];
        const last = parts.length > 1 ? parts.slice(1).join(' ') : '';

        document.getElementById('qaFirst').value = first;
        document.getElementById('qaLast').value = last;

        if (!last) document.getElementById('qaLast').focus();
        else document.getElementById('qaEmail').focus();
      }

      document.getElementById('qaSaveToDB').checked = true;
    }

    async function handleSavePassengerSearch() {
      const originalVal = document.getElementById('savePassengerSearch').value.trim();
      const query = originalVal.toLowerCase();
      const resultsDiv = document.getElementById('savePassengerResults');

      // Proceed even if query is short/empty

      if (allPassengersCache.length === 0) {
        const res = await fetch('/api/v2/passengers');
        const data = await res.json();
        allPassengersCache = data.passengers;
      }

      const filtered = allPassengersCache.filter(p =>
        (p.first_name + ' ' + p.last_name).toLowerCase().includes(query) ||
        (p.email && p.email.toLowerCase().includes(query))
      ).slice(0, 5);

      let html = '';

      if (filtered.length > 0) {
        html += filtered.map((p, idx) => `
            <div class="search-item" onclick='addSavePassenger(${JSON.stringify(p).replace(/'/g, "&apos;")})' 
                 style="padding:12px 15px; cursor:pointer; border-bottom:1px solid var(--border-color); display:flex; align-items:center; gap:12px; transition: background 0.2s;">
                <div class="avatar" style="width:32px; height:32px; border-radius:50%; background:#8b5cf6; color:white; display:flex; align-items:center; justify-content:center; font-weight:bold; flex-shrink:0; font-size:13px;">
                  ${(p.first_name || '').charAt(0)}${(p.last_name || '').charAt(0)}
                </div>
                <div style="flex-grow:1; line-height:1.4;">
                  <div style="font-weight:600; color:var(--text-primary); font-size:0.95rem;">${p.title ? p.title + ' ' : ''}${p.first_name} ${p.last_name}</div>
                  <div style="font-size:0.8rem; color:var(--text-secondary);">${p.email || 'No email'} ${p.phone ? '• ' + p.phone : ''}</div>
                </div>
            </div>
        `).join('');
      }

      // Append Options
      if (query.trim().length > 0) {
        // Option 2: Create New (Full Record)
        html += `
            <div class="search-item" onclick="prepareNewPassenger('${originalVal.replace(/'/g, "\\'")}')" 
                 style="padding:12px 15px; cursor:pointer; border-bottom:1px solid var(--border-color); display:flex; align-items:center; gap:12px; transition: background 0.2s; background: rgba(16, 185, 129, 0.05); color: var(--success);">
                <div class="avatar" style="width:32px; height:32px; border-radius:50%; background:var(--success); color:white; display:flex; align-items:center; justify-content:center; font-weight:bold; flex-shrink:0; font-size:16px;">✎</div>
                <div style="flex-grow:1; line-height:1.4;">
                  <div style="font-weight:600; font-size:0.95rem;">Create New: "${originalVal}"</div>
                  <div style="font-size:0.8rem; opacity:0.8;">Add full details to database</div>
                </div>
            </div>`;

      } else if (filtered.length === 0 && query.length > 0) {
        html = '<div style="padding:15px; text-align:center; color:var(--text-secondary);">No passengers found for "' + originalVal + '"</div>';
      } else if (filtered.length === 0 && query.length === 0) {
        html = '<div style="padding:15px; text-align:center; color:var(--text-secondary);">No passengers found. Use the form to create new.</div>';
      }

      if (html) {
        resultsDiv.innerHTML = html;
        resultsDiv.style.display = 'block';
      } else {
        resultsDiv.style.display = 'none';
      }
    }

    function addTemporaryPassengerFromSearch(name) {
      if (!name) return;
      const parts = name.trim().split(' ');
      const first = parts[0];
      const last = parts.length > 1 ? parts.slice(1).join(' ') : '';

      const newPax = {
        id: 'temp_' + Date.now(),
        first_name: first,
        last_name: last,
        email: '',
        phone: '',
        is_db: false
      };

      addSavePassenger(newPax);
      document.getElementById('savePassengerResults').style.display = 'none';
    }

    function addSavePassenger(p) {
      if (savePassengers.some(existing => existing.id === p.id)) {
        showNotification('Passenger already added', 'warning');
        return;
      }



      // Explicitly mark as DB passenger
      savePassengers.push({
        id: p.id,
        passenger_id: p.id,
        first_name: p.first_name,
        last_name: p.last_name,
        email: p.email,
        phone: p.phone,
        is_db: true
      });

      renderSavePassengers();

      document.getElementById('savePassengerSearch').value = '';
      document.getElementById('savePassengerResults').style.display = 'none';
      showNotification('Passenger added', 'success');
    }

    function updatePassengerCapacity() {
      // Just validation visual if needed
    }

    function toggleQuickAddPassenger() {
      const form = document.getElementById('quickAddPassengerForm');
      form.style.display = form.style.display === 'none' ? 'block' : 'none';
    }

    async function addQuickPassenger() {
      const title = document.getElementById('qaTitle').value;
      const first = document.getElementById('qaFirst').value.trim();
      const last = document.getElementById('qaLast').value.trim();
      const email = document.getElementById('qaEmail').value.trim();
      const phone = document.getElementById('qaPhone').value.trim();
      const saveToDb = document.getElementById('qaSaveToDB').checked;

      if (!first || !last) {
        showNotification('First and Last Name are required', 'warning'); return; 
      }

      const newPax = {
        title: title,
        first_name: first,
        last_name: last,
        email: email,
        phone: phone,
        is_db: false
      };

      if (saveToDb) {
        try {
          const r = await fetch('/api/v2/passengers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newPax)
          });

          if (r.ok) {
            const d = await r.json();
            newPax.is_db = true;
            newPax.id = d.passenger.id;
            newPax.passenger_id = d.passenger.id;
            showNotification('Passenger saved to Database', 'success');
            allPassengersCache = []; // Clear cache
            if (typeof isCustomersLoaded !== 'undefined') isCustomersLoaded = false;
          } else if (r.status === 409) {
            const err = await r.json();
            showNotification(err.error || 'Duplicate passenger found. Please check details.', 'error');
            return; // Strict: do not add to list if failed
          } else {
            showNotification('Failed to save to DB. Please try again.', 'error');
            return; // Strict
          }
        } catch (e) {
          console.error(e);
          showNotification('Error saving passenger', 'error');
          return;
        }
      }

      savePassengers.push(newPax);

      renderSavePassengers();

      toggleQuickAddPassenger();

      // Clear form
      document.getElementById('qaFirst').value = '';
      document.getElementById('qaLast').value = '';
      document.getElementById('qaEmail').value = '';
      document.getElementById('qaPhone').value = '';
    }

    function removeSavePassenger(index) {
      savePassengers.splice(index, 1);
      renderSavePassengers();
      renderFpAddedPassengers();
      renderResults(currentFlights, true);
    }

    // --- Flight Card Passenger Modal Logic ---
    let activeFlightIndexForPassenger = -1;

    let fetchPassengersPromise = null;

    async function ensurePassengersLoaded() {
        if (allPassengersCache.length > 0) return;
        if (fetchPassengersPromise) {
            await fetchPassengersPromise;
            return;
        }
        fetchPassengersPromise = fetch('/api/v2/passengers')
            .then(r => r.json())
            .then(d => {
                allPassengersCache = d.passengers || [];
                fetchPassengersPromise = null;
            })
            .catch(err => {
                console.error("Failed to load passengers", err);
                fetchPassengersPromise = null;
            });
        await fetchPassengersPromise;
    }

    async function openFlightPassengerModal(index) {
        activeFlightIndexForPassenger = index;
        document.getElementById('flightPassengerModal').classList.add('active');
        document.getElementById('fpSearch').value = '';
        document.getElementById('fpSearchResults').style.display = 'none';
        document.getElementById('fpNewPassengerForm').style.display = 'none';
        renderFpAddedPassengers();
        
        await ensurePassengersLoaded();
        
        // Auto-show linked passengers if any
        searchFlightPassenger();
    }

    function closeFlightPassengerModal() {
        document.getElementById('flightPassengerModal').classList.remove('active');
        activeFlightIndexForPassenger = -1;
    }

    async function searchFlightPassenger() {
        const query = document.getElementById('fpSearch').value.toLowerCase().trim();
        const resultsDiv = document.getElementById('fpSearchResults');
        const originalVal = document.getElementById('fpSearch').value.trim();

        if (query.length === 0) {
            if (window.BillingModule && window.BillingModule.state.linkedPassengers && window.BillingModule.state.linkedPassengers.length > 0) {
                const linked = window.BillingModule.state.linkedPassengers;
                let html = '<div style="padding: 10px 15px; font-size: 0.8rem; font-weight: 700; background: var(--bg-main); border-bottom: 1px solid var(--border-color); color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px;">Linked Billing Passengers</div>';
                html += linked.map(p => `
                    <div class="search-item" onclick='assignDbPassengerToFlight(${JSON.stringify(p).replace(/'/g, "&apos;")})' 
                         style="padding:12px 15px; cursor:pointer; border-bottom:1px solid var(--border-color); display:flex; align-items:center; gap:12px; transition: background 0.2s;">
                        <div class="avatar" style="width:32px; height:32px; border-radius:50%; background:var(--primary); color:white; display:flex; align-items:center; justify-content:center; font-weight:bold; flex-shrink:0; font-size:13px;">
                          ${(p.first_name || '').charAt(0)}${(p.last_name || '').charAt(0)}
                        </div>
                        <div style="flex-grow:1; line-height:1.4;">
                          <div style="font-weight:600; color:var(--text-primary); font-size:0.95rem;">${p.title ? p.title + ' ' : ''}${p.first_name} ${p.last_name}</div>
                          <div style="font-size:0.8rem; color:var(--text-secondary);">${p.email || 'No email'} ${p.phone ? '• ' + p.phone : ''}</div>
                        </div>
                    </div>
                `).join('');
                resultsDiv.innerHTML = html;
                resultsDiv.style.display = 'block';
                return;
            }
            resultsDiv.style.display = 'none';
            return;
        }

        await ensurePassengersLoaded();

        const filtered = allPassengersCache.filter(p =>
            ((p.first_name || '') + ' ' + (p.last_name || '')).toLowerCase().includes(query) ||
            (p.email && p.email.toLowerCase().includes(query)) ||
            (p.phone && p.phone.toLowerCase().includes(query))
        ).slice(0, 5);

        let html = '';
        if (filtered.length > 0) {
            html += filtered.map(p => `
                <div class="search-item" onclick='assignDbPassengerToFlight(${JSON.stringify(p).replace(/'/g, "&apos;")})' 
                     style="padding:12px 15px; cursor:pointer; border-bottom:1px solid var(--border-color); display:flex; align-items:center; gap:12px; transition: background 0.2s;">
                    <div class="avatar" style="width:32px; height:32px; border-radius:50%; background:#8b5cf6; color:white; display:flex; align-items:center; justify-content:center; font-weight:bold; flex-shrink:0; font-size:13px;">
                      ${(p.first_name || '').charAt(0)}${(p.last_name || '').charAt(0)}
                    </div>
                    <div style="flex-grow:1; line-height:1.4;">
                      <div style="font-weight:600; color:var(--text-primary); font-size:0.95rem;">${p.title ? p.title + ' ' : ''}${p.first_name} ${p.last_name}</div>
                      <div style="font-size:0.8rem; color:var(--text-secondary);">${p.email || 'No email'} ${p.phone ? '• ' + p.phone : ''}</div>
                    </div>
                </div>
            `).join('');
        }

        html += `
            <div class="search-item" onclick="prepareNewFlightPassenger('${originalVal.replace(/'/g, "\\'")}')" 
                 style="padding:12px 15px; cursor:pointer; border-bottom:1px solid var(--border-color); display:flex; align-items:center; gap:12px; transition: background 0.2s; background: rgba(16, 185, 129, 0.05); color: var(--success);">
                <div class="avatar" style="width:32px; height:32px; border-radius:50%; background:var(--success); color:white; display:flex; align-items:center; justify-content:center; font-weight:bold; flex-shrink:0; font-size:16px;">+</div>
                <div style="flex-grow:1; line-height:1.4;">
                  <div style="font-weight:600; font-size:0.95rem;">Create New: "${originalVal}"</div>
                </div>
            </div>`;

        resultsDiv.innerHTML = html;
        resultsDiv.style.display = 'block';
    }

    function toggleFpNewForm(show) {
        document.getElementById('fpNewPassengerForm').style.display = show ? 'block' : 'none';
        if (!show) {
            document.getElementById('fpSearch').value = '';
            // Only hide search results if we don't have linked passengers to show
            searchFlightPassenger();
        }
    }

    function prepareNewFlightPassenger(val) {
        toggleFpNewForm(true);
        document.getElementById('fpSearchResults').style.display = 'none';
        const parts = val.trim().split(' ');
        document.getElementById('fpFirst').value = parts[0] || '';
        document.getElementById('fpLast').value = parts.slice(1).join(' ') || '';
        document.getElementById('fpEmail').value = val.includes('@') ? val : '';
        document.getElementById('fpPhone').value = /^\d+$/.test(val) ? val : '';
    }

    function assignDbPassengerToFlight(p) {
        _assignPassengerToFlightState(p);
    }

    async function addFlightPassengerNew() {
        const title = document.getElementById('fpTitle').value;
        const first = document.getElementById('fpFirst').value.trim();
        const last = document.getElementById('fpLast').value.trim();
        const email = document.getElementById('fpEmail').value.trim();
        const phone = document.getElementById('fpPhone').value.trim();
        const saveToDb = document.getElementById('fpSaveDB').checked;

        if (!first || !last) {
            showNotification('First and Last Name are required', 'warning'); return;
        }

        const newPax = {
            title: title,
            first_name: first,
            last_name: last,
            email: email,
            phone: phone,
            is_db: false,
            id: 'temp_' + Date.now()
        };

        if (saveToDb) {
            try {
                const res = await fetch('/api/v2/passengers', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(newPax)
                });
                if (res.ok) {
                    const saved = await res.json();
                    newPax.id = saved.passenger.id;
                    newPax.passenger_id = saved.passenger.id;
                    newPax.is_db = true;
                    allPassengersCache = [];
                    if (typeof isCustomersLoaded !== 'undefined') isCustomersLoaded = false;
                } else {
                    showNotification('Error saving passenger to DB', 'error');
                }
            } catch (e) {
                console.error(e);
            }
        }

        _assignPassengerToFlightState(newPax);

        // Clear inputs to prevent duplicate assignment on next click
        document.getElementById('fpFirst').value = '';
        document.getElementById('fpLast').value = '';
        document.getElementById('fpEmail').value = '';
        document.getElementById('fpPhone').value = '';
    }

    function _assignPassengerToFlightState(p) {
        const name = p.first_name + ' ' + (p.last_name || '');
        if (activeFlightIndexForPassenger === -1) {
            currentFlights.forEach(f => {
                f.passenger_name = name;
                f.passenger_id = p.id;
            });
        } else {
            const flight = currentFlights[activeFlightIndexForPassenger];
            if (flight) {
                flight.passenger_name = name;
                flight.passenger_id = p.id;
            }
        }
        
        if (!savePassengers.some(existing => existing.id === p.id)) {
            savePassengers.push({
                id: p.id,
                passenger_id: p.id,
                first_name: p.first_name,
                last_name: p.last_name,
                email: p.email,
                phone: p.phone,
                is_db: p.is_db || false
            });
        }
        renderSavePassengers();

        renderFpAddedPassengers();
        document.getElementById('fpSearch').value = '';
        document.getElementById('fpSearchResults').style.display = 'none';
        toggleFpNewForm(false);
        renderResults(currentFlights, true);
        snapshotCurrentFareStateForDraft();
        showNotification('Passenger added successfully', 'success');
    }

    function removeFlightPassenger(id) {
        savePassengers = savePassengers.filter(p => p.id !== id);
        renderSavePassengers();
        renderFpAddedPassengers();
        renderResults(currentFlights, true);
        snapshotCurrentFareStateForDraft();
    }

    function renderFpAddedPassengers() {
        const list = document.getElementById('fpAddedPassengersList');
        if (!list) return;
        if (savePassengers.length === 0) {
            list.innerHTML = '<div style="color: var(--text-secondary); font-size: 0.9rem; padding: 10px; background: rgba(0,0,0,0.02); border-radius: 8px; text-align: center;">No passengers added yet. Search or create one to add.</div>';
            return;
        }
        list.innerHTML = savePassengers.map(p => `
            <div style="display:flex; justify-content:space-between; align-items:center; padding: 10px 15px; background: var(--bg-hover); border-radius: 8px; border: 1px solid var(--border);">
                <div style="font-weight: 500; font-size: 0.95rem;">${p.title ? p.title + ' ' : ''}${p.first_name} ${p.last_name || ''}</div>
                <button onclick="removeFlightPassenger('${p.id}')" style="background: none; border: none; color: var(--danger); cursor: pointer; font-size: 1.2rem; display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 4px; transition: background 0.2s;" onmouseover="this.style.background='rgba(239, 68, 68, 0.1)'" onmouseout="this.style.background='none'">&times;</button>
            </div>
        `).join('');
    }

    function renderSavePassengers() {
      const container = document.getElementById('savePassengerList');
      const countDisplay = document.getElementById('passengerCountDisplay');

      if (countDisplay) countDisplay.textContent = savePassengers.length;

      if (savePassengers.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 20px; font-style: italic;">No passengers added yet. Search above to add.</div>';
        return;
      }

      container.innerHTML = savePassengers.map((p, i) => `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:12px; border:1px solid var(--border-color); margin-bottom:8px; border-radius:8px; background:var(--bg-card); box-shadow:0 1px 2px rgba(0,0,0,0.05);">
                <div style="flex-grow:1; display:flex; align-items:center; gap:12px;">
                    <div class="avatar" style="width:36px; height:36px; border-radius:50%; background:${p.is_db ? '#10b981' : '#f59e0b'}; color:white; display:flex; align-items:center; justify-content:center; font-weight:bold; flex-shrink:0; font-size:14px;">
                      ${(p.first_name || '').charAt(0)}${(p.last_name || '').charAt(0)}
                    </div>
                    <div>
                        <div style="display:flex; align-items:center;">
                            <span style="font-weight:600; color:var(--text-primary); margin-right:8px; font-size:0.95rem;">${p.title ? p.title + ' ' : ''}${p.first_name || ''} ${p.last_name || ''}</span>
                        </div>
                        <div style="font-size:0.85em; color:var(--text-secondary); margin-top:2px;">${p.email || 'No email'} ${p.phone ? ' • ' + p.phone : ''}</div>
                    </div>
                </div>
                <div>
                   <button onclick="removeSavePassenger(${i})" style="background:none; border:none; color:var(--text-secondary); cursor:pointer; width:32px; height:32px; border-radius:4px; display:flex; align-items:center; justify-content:center; transition:all 0.2s;" onmouseover="this.style.color='var(--danger)';this.style.background='rgba(239, 68, 68, 0.1)'" onmouseout="this.style.color='var(--text-secondary)';this.style.background='none'">
                     ✕
                   </button>
                </div>
            </div>
        `).join('');
    }

    async function savePaxToDB(index) {
      const p = savePassengers[index];
      if (!p || p.is_db) return;
      try {
        const r = await fetch('/api/v2/passengers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            first_name: p.first_name || '',
            last_name: p.last_name || '',
            email: p.email || '',
            phone: p.phone || ''
          })
        });
        if (r.ok) {
          const data = await r.json();
          // Update the local passenger to reflect DB status
          savePassengers[index].is_db = true;
          savePassengers[index].id = data.passenger ? data.passenger.id : data.id;
          savePassengers[index].passenger_id = data.passenger ? data.passenger.id : data.id;
          renderSavePassengers();

          // Refresh cache
          allPassengersCache = [];
          if (typeof isCustomersLoaded !== 'undefined') isCustomersLoaded = false;
          showNotification('Passenger saved to database!', 'success');
        } else {
          const e = await r.json();
          showNotification(e.error || 'Failed to save passenger', 'error');
        }
      } catch (e) { showNotification('Error saving passenger', 'error'); }
    }

    function calculateTotalAmount() {
      if (!Array.isArray(currentFlights) || currentFlights.length === 0) return 0;

      let grandTotal = 0;
      // Get trip type from radio buttons
      let tripType = 'one_way';
      const tripRadio = document.querySelector('input[name="tripType"]:checked');
      if (tripRadio) tripType = tripRadio.value;

      const globalMU = parseFloat(document.getElementById('markup').value) || 0;
      const globalSVC = parseFloat(document.getElementById('serviceCharge').value) || 0;

      const getFlightTotal = (f) => {
        if (!f) return 0;
        let base = 0;
        let type = 'saver';

        if (f.fares && Object.keys(f.fares).length > 0) {
          type = Object.keys(f.fares)[0];
          base = parseFloat(f.fares[type]) || 0;
        } else {
          base = parseFloat(f.saver_fare) || parseFloat(f.price) || 0;
        }

        const mu = (f.fare_mu && f.fare_mu[type] !== undefined) ? parseFloat(f.fare_mu[type]) : (f.markup !== undefined ? parseFloat(f.markup) : globalMU);
        const svc = (f.fare_svc && f.fare_svc[type] !== undefined) ? parseFloat(f.fare_svc[type]) : (f.service_charge !== undefined ? parseFloat(f.service_charge) : globalSVC);
        const gst = svc > 0 ? Math.round(svc * 0.18) : 0;

        return base + mu + svc + gst;
      };

      if (tripType === 'round_trip') {
        // Use first two segments (assuming they are outbound and return for first option)
        grandTotal = getFlightTotal(currentFlights[0]) + getFlightTotal(currentFlights[1]);
      } else if (tripType === 'multi_city') {
        // Sum segments belonging to the first unit
        const firstUnitId = (currentFlights[0] && currentFlights[0].unit_id) || '1';
        currentFlights.forEach(f => {
          if ((f.unit_id || '1') === firstUnitId) {
            grandTotal += getFlightTotal(f);
          }
        });
      } else {
        // One way: use first flight result as default baseline
        grandTotal = getFlightTotal(currentFlights[0]);
      }

      return grandTotal;
    }

    // --- Final Submit ---
    async function submitItinerary(isAutosave = false) {
      const btn = document.getElementById('finalSaveBtn');
      const loading = document.getElementById('saveBtnLoading');
      const text = document.getElementById('saveBtnText');
      let title = document.getElementById('saveItineraryTitle') ? document.getElementById('saveItineraryTitle').value : '';
      const billingId = document.getElementById('billingAccountSelect') ? document.getElementById('billingAccountSelect').value : '';

      if (!title) {
        title = "Itinerary - " + new Date().toLocaleDateString();
      }

      if (!isAutosave && btn && loading && text) {
        btn.disabled = true;
        loading.style.display = 'block';
        text.style.display = 'none';
      }

      try {
        const firstDbPassenger = savePassengers.find(p => p.is_db);

        // Determine billing details and type
        let finalBillingType = 'passenger';
        const billData = {
          name: null, company: null, address: null,
          gst: null, email: null, phone: null
        };

        if (tempBillingDetails) {
          finalBillingType = tempBillingDetails.company_name ? 'corporate' : 'passenger';
          billData.name = tempBillingDetails.display_name;
          billData.company = tempBillingDetails.company_name;
          billData.address = tempBillingDetails.address;
          billData.gst = tempBillingDetails.gst_number;
          billData.email = tempBillingDetails.email;
          billData.phone = tempBillingDetails.phone;
        } else if (billingId) {
          const acc = billingAccounts.find(a => a.id == billingId);
          if (acc) {
            finalBillingType = acc.company_name ? 'corporate' : 'passenger';
            billData.name = acc.contact_name || acc.display_name;
            billData.company = acc.company_name;
            billData.address = acc.address;
            billData.gst = acc.gst_number;
            billData.email = acc.email;
            billData.phone = acc.phone;
          }
        } else if (document.getElementById('billingSearchInput') && document.getElementById('billingSearchInput').value.trim()) {
          // Fallback: use manual unsaved input (Simple Bill To)
          const manualName = document.getElementById('billingSearchInput').value.trim();
          finalBillingType = 'passenger';
          billData.name = manualName;
        }

        // Determine supplier details
        const supplierId = document.getElementById('supplierAccountSelect') ? document.getElementById('supplierAccountSelect').value : null;
        const supData = {
          name: null, email: null, phone: null, address: null, company: null, gst: null
        };

        if (tempSupplierDetails) {
          supData.name = tempSupplierDetails.display_name;
          supData.email = tempSupplierDetails.email;
          supData.phone = tempSupplierDetails.phone;
          supData.address = tempSupplierDetails.address;
          supData.company = tempSupplierDetails.company_name;
          supData.gst = tempSupplierDetails.gst_number;
        } else if (supplierId) {
          const acc = supplierAccounts.find(a => a.id == supplierId);
          if (acc) {
            supData.name = acc.display_name;
            supData.email = acc.email;
            supData.phone = acc.phone;
            supData.address = acc.address;
            supData.company = acc.company_name;
            supData.gst = acc.gst_number;
          }
        }

        // Determine trip type from radio buttons
        let tripType = 'one_way';
        const tripRadio = document.querySelector('input[name="tripType"]:checked');
        if (tripRadio) tripType = tripRadio.value;

        // Capture raw input state for edit capability
        const rawInputData = { mode: tripType };
        try {
          const textareas = document.querySelectorAll('textarea');
          rawInputData.flight_texts = Array.from(textareas).map(ta => ta.value);
        } catch (e) { }

        const latestFlightsSnapshot = snapshotCurrentFareStateForDraft();
        let finalFlightsForSave = applyUnitMetadataToFlights(latestFlightsSnapshot);

        const payload = {
          title: title,
          reference_number: document.getElementById('saveReferenceNumber') ? document.getElementById('saveReferenceNumber').value : '',
          trip_type: tripType,
          passenger_id: firstDbPassenger ? firstDbPassenger.id : null,
          billing_account_id: billingId || null,
          supplier_account_id: supplierId || null,
          num_passengers: savePassengers.length || 1,
          passengers_data: savePassengers,
          // Flight Data
          flights: finalFlightsForSave,
          final_text: currentFinalText,
          raw_input_data: rawInputData,
          // Costing
          markup: parseFloat(document.getElementById('markup').value) || 0,
          service_charge: parseFloat(document.getElementById('serviceCharge').value) || 0,
          total_amount: calculateTotalAmount()
        };

        // Explicit Billing Details
        const searchInputVal = document.getElementById('flightBillingSearchInput') ? document.getElementById('flightBillingSearchInput').value.trim() : '';
        if (billData.name || (!billingId && !tempBillingDetails && !searchInputVal)) {
          payload.bill_to_name = billData.name;
          payload.bill_to_company = billData.company;
          payload.bill_to_address = billData.address;
          payload.bill_to_gst = billData.gst;
          payload.bill_to_email = billData.email;
          payload.bill_to_phone = billData.phone;
          payload.billing_type = finalBillingType;
        }

        // Explicit Supplier Details
        if (supData.name || !supplierId) {
          payload.supplier_name = supData.name;
          payload.supplier_email = supData.email;
          payload.supplier_phone = supData.phone;
          payload.supplier_address = supData.address;
          payload.supplier_company = supData.company;
          payload.supplier_gst = supData.gst;
        }

        payload.raw_input_data.unit_flights = buildOrderedUnitFlightMap(finalFlightsForSave.length);

        // If editing existing itinerary, update it; otherwise create new
        const isEditing = !!editingItineraryId;
        const apiUrl = isEditing ? '/api/v2/itineraries/' + editingItineraryId : '/api/v2/itineraries';
        const method = isEditing ? 'PUT' : 'POST';

        const response = await fetch(apiUrl, {
          method: method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (response.ok) {
          const result = await response.json();
          const itinId = result.itinerary ? result.itinerary.id : editingItineraryId;
          
          if (!isEditing && itinId) {
            editingItineraryId = itinId;
            document.getElementById('saveModal').dataset.currentlyEditingId = editingItineraryId;
          }

          if (!isAutosave) {
            showNotification(isEditing ? 'Itinerary updated successfully!' : 'Itinerary saved successfully!', 'success');
            closeSaveModal();
            localStorage.removeItem('flight_itinerary_draft');

            // Redirect to the itinerary detail
            setTimeout(() => {
              window.location.href = '/itineraries' + (itinId ? '#' + itinId : '');
            }, 1500);
          } else {
            console.log('Autosaved itinerary', itinId);
            showNotification('Autosaved to database!', 'success', { duration: 2000 });
          }
        } else {
          const err = await response.json();
          if (!isAutosave) showNotification(err.error || 'Failed to save itinerary', 'error');
          else console.error('Autosave failed:', err.error);
        }
      } catch (e) {
        console.error(e);
        if (!isAutosave) showNotification('Error saving itinerary', 'error');
      } finally {
        if (!isAutosave && btn && loading && text) {
          btn.disabled = false;
          text.style.display = 'inline';
          loading.style.display = 'none';
        }
      }
    }

    // --- Modal Logic ---
    let warningModalResolve = null;
    let deleteModalResolve = null;

    function showWarningModal(message) {
      if (message) {
        document.getElementById('warningMessage').textContent = message;
      }
      document.getElementById('warningModal').classList.add('is-active');
      return new Promise((resolve) => {
        warningModalResolve = resolve;
      });
    }

    function closeWarningModal(result) {
      document.getElementById('warningModal').classList.remove('is-active');
      if (warningModalResolve) {
        warningModalResolve(result);
        warningModalResolve = null;
      }
    }

    // --- Saved Itinerary Modal Logic ---
    let savedModalResolve = null;

    function showSavedItineraryModal() {
      document.getElementById('savedItineraryModal').classList.add('is-active');
      return new Promise((resolve) => {
        savedModalResolve = resolve;
      });
    }

    function closeSavedItineraryModal(shouldRedirect) {
      document.getElementById('savedItineraryModal').classList.remove('is-active');
      document.body.style.overflow = '';
      if (savedModalResolve) {
        savedModalResolve(shouldRedirect);
        savedModalResolve = null;
      }
    }

    function showDeleteModal(title, message) {
      if (title) document.getElementById('deleteModalTitle').textContent = title;
      if (message) document.getElementById('deleteModalMessage').textContent = message;
      document.getElementById('deleteModal').classList.add('show');
      return new Promise((resolve) => {
        deleteModalResolve = resolve;
      });
    }

    function closeDeleteModal(result) {
      document.getElementById('deleteModal').classList.remove('show');
      if (deleteModalResolve) {
        deleteModalResolve(result);
        deleteModalResolve = null;
      }
    }

    // Handle trip type changes
    function handleTripType() {
      const tripType = document.querySelector('input[name="tripType"]:checked').value;
      currentTripType = tripType;

      // Reset all flight inputs
      const flightInputs = document.getElementById('flightInputs');
      flightInputs.innerHTML = '';
      unitCount = 0;
      flightCount = 0;
      unitFlightCounts = {};
      unitFlights = {};

      const addUnitBtn = document.getElementById('addUnitBtn');

      if (tripType === 'one_way') {
        addUnitBtn.style.display = 'inline-flex';
        document.getElementById('addUnitLabel').textContent = 'Add Another Option';
        addUnit();
      } else if (tripType === 'round_trip') {
        addUnitBtn.style.display = 'inline-flex';
        document.getElementById('addUnitLabel').textContent = 'Add Another Option';
        addUnit();
      } else if (tripType === 'multi_city') {
        addUnitBtn.style.display = 'inline-flex';
        document.getElementById('addUnitLabel').textContent = 'Add Another Option';
        addUnit();
      }
    }

    // Add a unit based on trip type
    function addUnit() {
      unitCount++;
      const container = document.getElementById('flightInputs');
      const unit = document.createElement('div');
      unit.className = 'flight-unit';
      unit.dataset.unitId = unitCount;

      if (currentTripType === 'one_way') {
        // One Way: 1 unit = 1 flight + shared fares
        unit.innerHTML = createOneWayUnit(unitCount);
      } else if (currentTripType === 'round_trip') {
        // Round Trip: 1 unit = 2 flights (outbound + return) + shared fares
        unit.className += ' row';
        unit.innerHTML = createRoundTripUnit(unitCount);
      } else if (currentTripType === 'multi_city') {
        // Multi City: 1 unit = 1 flight initially, can add more with "Add City" button
        unit.className += ' multi';
        unit.innerHTML = createMultiCityUnit(unitCount);
      }

      container.appendChild(unit);

      // Initialize fares for the new unit
      initializeUnitFares(unitCount);
    }

    function createOneWayUnit(unitId) {
      const flightId = ++flightCount;
      unitFlights[unitId] = [flightId];

      return `
    ${unitId > 1 ? `<div class="flight-unit-header"><h3>Option ${unitId}</h3><button type="button" onclick="removeUnit(${unitId})">🗑️ Remove Option</button></div>` : ''}
    ${createFlightBox(flightId, 'Departure', true)}
    ${createSharedFareSection(unitId)}
  `;
    }

    function createRoundTripUnit(unitId) {
      const outboundId = ++flightCount;
      const returnId = ++flightCount;
      unitFlights[unitId] = [outboundId, returnId];

      const gdsToggleHTML = `
        <div class="gds-switch-container">
          <label class="gds-switch">
            <input type="checkbox" id="gds-toggle-${unitId}" onchange="toggleGdsMode(${unitId})">
            <span class="slider round"></span>
            <span class="gds-switch-label">GDS Mode</span>
          </label>
        </div>
      `;

      const gdsInputHTML = `
        <div class="gds-input-container" id="gds-input-container-${unitId}" style="display:none; width:100%;">
          <textarea id="gds-textarea-${unitId}" placeholder="Paste GDS text here...&#10;&#10;Example:&#10; EK 513 Y 10JUN DELDXB  0415 0645&#10; EK 201 Y 10JUN DXBJFK  0845 1420&#10; EK 202 Y 20JUN JFKDXB  2310 1950&#10; EK 512 Y 22JUN DXBDEL  0910 1415&#10;&#10;Supports: Amadeus, Sabre, Galileo formats"></textarea>
        </div>
      `;

      return `
    ${unitId > 1 ? `<div class="flight-unit-header"><h3>Option ${unitId}</h3><button type="button" onclick="removeUnit(${unitId})">🗑️ Remove Option</button></div>` : ''}
    ${gdsToggleHTML}
    ${gdsInputHTML}
    ${createFlightBox(outboundId, 'Outbound Flight')}
    ${createFlightBox(returnId, 'Return Flight')}
    
    <div class="fare-split-control" style="width: 100%; clear: both; margin: 1.5rem 0 1rem 0; padding: 0 0.25rem;">
        <label style="display: flex; align-items: center; gap: 0.5rem; font-weight: 500; cursor: pointer;">
            <input type="checkbox" id="split-fares-toggle-${unitId}" onchange="toggleSplitFares(${unitId})">
            <span>Separate Fares for Outbound & Return</span>
        </label>
    </div>

    <div id="fares-combined-wrapper-${unitId}">
        ${createSharedFareSection(unitId, '', '📊 Fare Options (Combined)')}
    </div>

    <div id="fares-split-wrapper-${unitId}" style="display: none; gap: 1rem; flex-wrap: wrap;">
        <div style="flex: 1; min-width: 300px;">
            ${createSharedFareSection(unitId, '_out', '✈️ Outbound Fares')}
        </div>
        <div style="flex: 1; min-width: 300px;">
             ${createSharedFareSection(unitId, '_ret', '✈️ Return Fares')}
        </div>
    </div>
  `;
    }

    function toggleSplitFares(unitId) {
      const toggle = document.getElementById(`split-fares-toggle-${unitId}`);
      const combinedWrapper = document.getElementById(`fares-combined-wrapper-${unitId}`);
      const splitWrapper = document.getElementById(`fares-split-wrapper-${unitId}`);

      if (toggle && toggle.checked) {
        // Copy values from combined to outbound before hiding
        const combinedFares = document.querySelectorAll(`#fare-list-${unitId} .fare-card`);
        combinedFares.forEach(card => {
          const fareKey = card.dataset.fareKey;
          const sourceUniqueKey = `${fareKey}-unit-${unitId}`;
          const outUniqueKey = `${fareKey}-unit-${unitId}_out`;

          // If outbound card doesn't exist (e.g. user added custom fare to combined), add it
          if (!document.getElementById(`fare-card-${outUniqueKey}`)) {
            const outList = document.getElementById(`fare-list-${unitId}_out`);
            const retList = document.getElementById(`fare-list-${unitId}_ret`);
            const label = card.querySelector('label')?.textContent || '';
            const sourceChk = document.getElementById(`chk-${sourceUniqueKey}`);

            if (outList) outList.insertAdjacentHTML('beforeend', createFareCard(fareKey, label, unitId, sourceChk ? sourceChk.checked : true, '_out'));
            if (retList) retList.insertAdjacentHTML('beforeend', createFareCard(fareKey, label, unitId, sourceChk ? sourceChk.checked : true, '_ret'));
          }

          const copyValue = (selectorSuffix, targetUniqueKey) => {
            const src = document.querySelector(`.${selectorSuffix}-${sourceUniqueKey}`);
            const tgt = document.querySelector(`.${selectorSuffix}-${targetUniqueKey}`);
            if (src && tgt) tgt.value = src.value;
          };

          // Main fare fields
          copyValue('fare', outUniqueKey);
          copyValue('mu', outUniqueKey);
          copyValue('svc', outUniqueKey);

          // Extra details fields
          ['cabin', 'checkin', 'pcs', 'seat', 'meal', 'cancellation', 'penalty'].forEach(field => {
            copyValue(`fare-${field}`, outUniqueKey);
          });

          // Sync checkbox status
          const sourceChk = document.getElementById(`chk-${sourceUniqueKey}`);
          const outChk = document.getElementById(`chk-${outUniqueKey}`);
          if (sourceChk && outChk && sourceChk.checked && !outChk.checked) {
            outChk.checked = true;
            toggleFareCard(outChk, fareKey, unitId, '_out');
          }
        });

        combinedWrapper.style.display = 'none';
        splitWrapper.style.display = 'flex';
      } else {
        combinedWrapper.style.display = 'block';
        splitWrapper.style.display = 'none';
      }
    }

    function createMultiCityUnit(unitId) {
      const flightId = ++flightCount;
      unitFlights[unitId] = [flightId];
      unitFlightCounts[unitId] = 1;

      const gdsToggleHTML = `
        <div class="gds-switch-container">
          <label class="gds-switch">
            <input type="checkbox" id="gds-toggle-${unitId}" onchange="toggleGdsMode(${unitId})">
            <span class="slider round"></span>
            <span class="gds-switch-label">GDS Mode</span>
          </label>
        </div>
      `;

      const gdsInputHTML = `
        <div class="gds-input-container" id="gds-input-container-${unitId}" style="display:none; width:100%;">
          <textarea id="gds-textarea-${unitId}" placeholder="Paste GDS text here...&#10;&#10;Example:&#10; 6E 2341 S 30DEC CCU LKO 0600 0730&#10; 6E 1234 S 30DEC LKO DEL 0900 1030&#10;&#10;Supports: Amadeus, Sabre, Galileo formats"></textarea>
        </div>
      `;

      return `
    <div class="flight-unit-header"><h3>Option ${unitId}</h3><button type="button" onclick="addCityToUnit(${unitId})">➕ Add City</button>${unitId > 1 ? `<button type="button" onclick="removeUnit(${unitId})">🗑️ Remove Option</button>` : ''}</div>
    ${gdsToggleHTML}
    ${gdsInputHTML}
    <div id="unit-${unitId}-flights" style="display: contents;">
      ${createFlightBox(flightId, `City 1`)}
    </div>
    ${createSharedFareSection(unitId)}
  `;
    }

    function createFlightBox(flightId, label, showMultipleFlights = false) {
      const multipleFlightsCheckbox = showMultipleFlights ? `
        <label style="display:flex; align-items:center; gap:0.5rem; cursor:pointer; font-size: 0.85rem;">
            <input type="checkbox" class="multiple-flights-checkbox">
            <span>Multiple Flights</span>
        </label>
      ` : '';

      return `
    <div class="flight-block" data-flight-id="${flightId}">
      <div class="flight-header">
        <span class="flight-number">${label}</span>
        <div style="display: flex; gap: 1rem;">
            <label style="display:flex; align-items:center; gap:0.5rem; cursor:pointer; font-size: 0.85rem;">
                <input type="checkbox" class="layover-checkbox">
                <span>Has Layover</span>
            </label>
            ${multipleFlightsCheckbox}
        </div>
      </div>
      
      <div class="textarea-wrapper">
        <label class="textarea-label">Paste Flight Details (include price if available)</label>
        <textarea placeholder="Paste complete flight information here...
Example: 
Airline: IndiGo
Flight: 6E-123
Departure: Mumbai (BOM) - 10:30 AM
Arrival: Delhi (DEL) - 12:45 PM
Date: 28 Jan 2026
Duration: 2h 15m
Stops: Non-stop
Baggage: 15 Kg
Refundable
Price: ₹5,500

For Multiple Flights: Paste each flight's details separated by a blank line."></textarea>
      </div>
    </div>
  `;
    }

    function createSharedFareSection(unitId, suffix = '', labelOverride = '') {
      const isOneWay = currentTripType === 'one_way';
      let headingText = '';

      if (labelOverride) {
        headingText = labelOverride;
      } else {
        headingText = isOneWay ? `Fare Options (Option ${unitId})` : `📊 Fare Options for Option ${unitId}`;
      }

      const sectionId = `fare-section-${unitId}${suffix}`;
      const listId = `fare-list-${unitId}${suffix}`;

      return `
    <div class="shared-fare-section expanded" id="${sectionId}" data-unit-id="${unitId}" data-suffix="${suffix}">
      <div class="fare-section-header" onclick="toggleFareSection('${unitId}', '${suffix}')">
          <h4 style="margin: 0;">${headingText}</h4>
          <span class="fare-toggle-icon">▼</span>
      </div>
      
      <div class="fare-section-content" id="fare-content-${unitId}${suffix}">
        <div class="fare-types" id="${listId}">
          ${createFareCard('saver', 'Saver Fare', unitId, true, suffix)}
        </div>
        <div class="add-fare-controls" style="margin-top: 1rem; border-top: 1px dashed var(--border); padding-top: 0.75rem;">
           <select class="form-select" style="width: 100%; max-width: 200px; padding: 0.5rem; font-size: 0.9rem; border-radius: 6px; border: 1.5px solid var(--border);" onchange="handleAddFareType(this, ${unitId}, '${suffix}')">
               <option value="">+ Add Fare Type...</option>
               <optgroup label="Fare Types">
                   <option value="corporate">Corporate Fare</option>
                   <option value="sme">SME Fare</option>
                   <option value="coupon">Coupon Fare</option>
                   <option value="flexi">Flexi Fare</option>
               </optgroup>
               <optgroup label="Cabin Classes">
                   <option value="economy">Economy</option>
                   <option value="premium_economy">Premium Economy</option>
                   <option value="business">Business Class</option>
                   <option value="first">First Class</option>
               </optgroup>
               <option value="custom">Custom...</option>
           </select>
        </div>
      </div>
    </div>
  `;
    }

    function formatBaggageInput(input) {
      let val = input.value.trim();
      // If value is just a number (integer or decimal), append 'kg'
      if (/^\d+(\.\d+)?$/.test(val)) {
        input.value = val + 'kg';
      }
    }

    function formatPiecesInput(input) {
      let val = input.value.trim();
      // If value is just a number (integer), append 'pcs'
      if (/^\d+$/.test(val)) {
        input.value = val + 'pcs';
      }
    }

    function toggleExtraField(uniqueKey, field) {
      const input = document.querySelector(`.fare-${field}-${uniqueKey}`);
      if (!input) return;
      if (input.value === 'Included') {
        input.value = 'Chargeable';
      } else if (input.value === 'Chargeable') {
        input.value = '';
      } else {
        input.value = 'Included';
      }
    }


    function toggleFareSection(unitId, suffix = '') {
      const section = document.getElementById(`fare-section-${unitId}${suffix}`);
      if (section) section.classList.toggle('expanded');
    }

    function toggleFareDetails(fareUniqueId) {
      const details = document.getElementById(fareUniqueId);
      const icon = document.getElementById(`fare-toggle-icon-${fareUniqueId}`);
      if (!details) return;

      if (details.style.display === 'none') {
        details.style.display = 'block';
        if (icon) icon.style.transform = 'rotate(180deg)';
      } else {
        details.style.display = 'none';
        if (icon) icon.style.transform = 'rotate(0deg)';
      }
    }

    function createFareCard(key, label, unitId, isChecked, suffix = '') {
      const checkedAttr = isChecked ? 'checked' : '';
      const disabledAttr = isChecked ? '' : 'disabled';
      const cardClass = isChecked ? 'fare-card' : 'fare-card disabled';
      const uniqueKey = `${key}-unit-${unitId}${suffix}`;
      const detailsId = `fare-details-input-${uniqueKey}`;

      return `
        <div class="${cardClass}" data-fare-key="${key}" id="fare-card-${uniqueKey}">
          <div class="fare-card-header">
            <input type="checkbox" id="chk-${uniqueKey}" onchange="toggleFareCard(this, '${key}', ${unitId}, '${suffix}')" ${checkedAttr}>
            <select class="fare-type-selector" onchange="changeFareCardType(this, '${key}', ${unitId}, '${suffix}')">
              <option value="saver" ${key === 'saver' ? 'selected' : ''}>Saver Fare</option>
              <option value="corporate" ${key === 'corporate' ? 'selected' : ''}>Corporate Fare</option>
              <option value="sme" ${key === 'sme' ? 'selected' : ''}>SME Fare</option>
              <option value="coupon" ${key === 'coupon' ? 'selected' : ''}>Coupon Fare</option>
              <option value="flexi" ${key === 'flexi' ? 'selected' : ''}>Flexi Fare</option>
              <option value="economy" ${key === 'economy' ? 'selected' : ''}>Economy</option>
              <option value="premium_economy" ${key === 'premium_economy' ? 'selected' : ''}>Premium Economy</option>
              <option value="business" ${key === 'business' ? 'selected' : ''}>Business Class</option>
              <option value="first" ${key === 'first' ? 'selected' : ''}>First Class</option>
              ${!['saver','corporate','sme','coupon','flexi','economy','premium_economy','business','first'].includes(key) ? `<option value="${key}" selected>${label}</option>` : ''}
              <option value="custom">Custom...</option>
            </select>
          </div>
          <div class="fare-card-fields">
            <div class="fare-field-row">
              <span class="fare-field-label">Fare</span>
              <input type="number" class="fare-field-input fare-${uniqueKey}" placeholder="${key === 'saver' ? 'Auto / Manual' : '₹ 0'}" min="0" ${disabledAttr}>
            </div>
            <div class="fare-field-row">
              <span class="fare-field-label">MU</span>
              <input type="number" class="fare-field-input mu-${uniqueKey}" placeholder="Markup" min="0" ${disabledAttr}>
            </div>
            <div class="fare-field-row">
              <span class="fare-field-label">SVC</span>
              <input type="number" class="fare-field-input svc-${uniqueKey}" placeholder="SVC" min="0" ${disabledAttr}>
            </div>
          </div>
          
          <div class="fare-extras-toggle" style="margin-top: 10px; border-top: 1px solid var(--border); padding-top: 8px;">
            <button type="button" onclick="toggleFareDetails('${detailsId}')" style="background: none; border: none; color: var(--primary); font-size: 0.75rem; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 4px; padding: 0;">
              <span>➕ Add Baggage & Extras</span>
              <span id="fare-toggle-icon-${detailsId}" style="transition: transform 0.3s ease;">▼</span>
            </button>
          </div>
          
          <div id="${detailsId}" style="display: none; margin-top: 10px; padding: 8px; background: rgba(0,0,0,0.02); border-radius: 6px;">
             <!-- Baggage -->
             <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-bottom: 8px;">
                <div>
                   <label style="font-size: 0.65rem; color: var(--text-secondary); display: block;">Cabin</label>
                   <input type="text" class="form-input fare-cabin-${uniqueKey}" placeholder="7kg" style="padding: 4px 6px; font-size: 0.75rem;" onblur="formatBaggageInput(this)">
                </div>
                <div>
                   <label style="font-size: 0.65rem; color: var(--text-secondary); display: block;">Check-in</label>
                   <input type="text" class="form-input fare-checkin-${uniqueKey}" placeholder="15kg" style="padding: 4px 6px; font-size: 0.75rem;" onblur="formatBaggageInput(this)">
                </div>
                <div>
                   <label style="font-size: 0.65rem; color: var(--text-secondary); display: block;">Pieces</label>
                   <input type="text" class="form-input fare-pcs-${uniqueKey}" placeholder="2pcs" style="padding: 4px 6px; font-size: 0.75rem;" onblur="formatPiecesInput(this)">
                </div>
             </div>
             <!-- Meal / Seat -->
             <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px;">
                <div>
                   <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 2px;">
                      <label style="font-size: 0.65rem; color: var(--text-secondary); display: block; margin: 0;">Seat</label>
                      <!-- <button type="button" class="fare-extra-toggle-btn" onclick="toggleExtraField('${uniqueKey}', 'seat')">Toggle</button> -->
                   </div>
                   <input type="text" class="form-input fare-seat-${uniqueKey}" placeholder="A12" style="padding: 4px 6px; font-size: 0.75rem;">
                </div>
                <div>
                   <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 2px;">
                      <label style="font-size: 0.65rem; color: var(--text-secondary); display: block; margin: 0;">Meal</label>
                      <!-- <button type="button" class="fare-extra-toggle-btn" onclick="toggleExtraField('${uniqueKey}', 'meal')">Toggle</button> -->
                   </div>
                   <input type="text" class="form-input fare-meal-${uniqueKey}" placeholder="Veg" style="padding: 4px 6px; font-size: 0.75rem;">
                </div>
             </div>
             <!-- Charges -->
             <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                <div>
                   <label style="font-size: 0.65rem; color: var(--text-secondary); display: block;">Cancel</label>
                   <input type="text" class="form-input fare-cancellation-${uniqueKey}" placeholder="3000" style="padding: 4px 6px; font-size: 0.75rem;">
                </div>
                <div>
                   <label style="font-size: 0.65rem; color: var(--text-secondary); display: block;">Change</label>
                   <input type="text" class="form-input fare-penalty-${uniqueKey}" placeholder="5000" style="padding: 4px 6px; font-size: 0.75rem;">
                </div>
             </div>
          </div>
        </div>
      `;
    }

    function changeFareCardType(select, oldKey, unitId, suffix = '') {
      let newKey = select.value;
      let newLabel = select.options[select.selectedIndex].text;

      if (newKey === 'custom') {
        const customName = prompt("Enter Name for Custom Fare Type:");
        if (!customName || customName.trim() === '') {
          select.value = oldKey; // Revert
          return;
        }
        newLabel = customName.trim();
        newKey = newLabel.toLowerCase().replace(/\s+/g, '_');
        select.options[select.selectedIndex].value = newKey;
        select.options[select.selectedIndex].text = newLabel;
      }

      const oldUniqueKey = `${oldKey}-unit-${unitId}${suffix}`;
      const newUniqueKey = `${newKey}-unit-${unitId}${suffix}`;

      const card = document.getElementById(`fare-card-${oldUniqueKey}`);
      if (!card) return;

      if (document.getElementById(`fare-card-${newUniqueKey}`)) {
        showNotification('This fare type is already in the list!', 'error');
        select.value = oldKey; // Revert
        return;
      }

      // Update Card
      card.id = `fare-card-${newUniqueKey}`;
      card.dataset.fareKey = newKey;
      
      // Update Checkbox
      const chk = document.getElementById(`chk-${oldUniqueKey}`);
      if (chk) {
        chk.id = `chk-${newUniqueKey}`;
        chk.setAttribute('onchange', `toggleFareCard(this, '${newKey}', ${unitId}, '${suffix}')`);
      }

      // Update Details section and toggle button
      const details = document.getElementById(`fare-details-input-${oldUniqueKey}`);
      if (details) {
        details.id = `fare-details-input-${newUniqueKey}`;
      }

      const btn = card.querySelector(`button[onclick="toggleFareDetails('fare-details-input-${oldUniqueKey}')"]`);
      if (btn) {
        btn.setAttribute('onclick', `toggleFareDetails('fare-details-input-${newUniqueKey}')`);
      }

      const icon = document.getElementById(`fare-toggle-icon-fare-details-input-${oldUniqueKey}`);
      if (icon) {
        icon.id = `fare-toggle-icon-fare-details-input-${newUniqueKey}`;
      }

      // Update all input classes
      const classMappings = ['fare', 'mu', 'svc', 'fare-cabin', 'fare-checkin', 'fare-pcs', 'fare-seat', 'fare-meal', 'fare-cancellation', 'fare-penalty'];
      classMappings.forEach(prefix => {
        const inputs = card.querySelectorAll(`.${prefix}-${oldUniqueKey}`);
        inputs.forEach(inp => {
          inp.classList.remove(`${prefix}-${oldUniqueKey}`);
          inp.classList.add(`${prefix}-${newUniqueKey}`);
        });
      });
      
      select.setAttribute('onchange', `changeFareCardType(this, '${newKey}', ${unitId}, '${suffix}')`);
    }

    function updateFareTotal(uniqueKey) {
      if (uniqueKey && uniqueKey.includes('inline-')) return;
      if (typeof snapshotCurrentFareStateForDraft === 'function' && typeof regenerateOutputText === 'function') {
        const latestFlights = snapshotCurrentFareStateForDraft();
        if (latestFlights && latestFlights.length > 0) {
          if (typeof applyUnitMetadataToFlights === 'function') {
            currentFlights = applyUnitMetadataToFlights(latestFlights);
          } else {
            currentFlights = latestFlights;
          }
          regenerateOutputText();
        }
      }
    }

    function toggleFareCard(checkbox, fareType, unitId, suffix = '') {
      const uniqueKey = `${fareType}-unit-${unitId}${suffix}`;
      const card = document.getElementById(`fare-card-${uniqueKey}`);
      const fareInput = document.querySelector(`.fare-${uniqueKey}`);
      const muInput = document.querySelector(`.mu-${uniqueKey}`);
      const svcInput = document.querySelector(`.svc-${uniqueKey}`);

      if (checkbox.checked) {
        card.classList.remove('disabled');
        if (fareInput) fareInput.disabled = false;
        if (muInput) muInput.disabled = false;
        if (svcInput) svcInput.disabled = false;
      } else {
        card.classList.add('disabled');
        if (fareInput) fareInput.disabled = true;
        if (muInput) muInput.disabled = true;
        if (svcInput) svcInput.disabled = true;
        if (fareInput) fareInput.value = '';
        if (muInput) muInput.value = '';
        if (svcInput) svcInput.value = '';
      }

      // Check if we need global markup
      updateGlobalMarkupRequirement();
      updateFareTotal(uniqueKey);
    }

    function updateGlobalMarkupRequirement() {
      // Check if all checked fare types have MU filled
      let allHaveMU = true;
      let anyChecked = false;

      document.querySelectorAll('.fare-card').forEach(card => {
        const checkbox = card.querySelector('input[type="checkbox"]');
        if (checkbox && checkbox.checked) {
          anyChecked = true;
          const fareKey = card.dataset.fareKey;
          const section = card.closest('.shared-fare-section');
          if (section) {
            const unitId = section.dataset.unitId;
            const suffix = section.dataset.suffix || '';
            const uniqueKey = `${fareKey}-unit-${unitId}${suffix}`;
            const muInput = document.querySelector(`.mu-${uniqueKey}`);
            if (!muInput || !muInput.value || muInput.value.trim() === '') {
              allHaveMU = false;
            }
          }
        }
      });

      const globalMarkupSection = document.getElementById('globalMarkupSection');
      if (globalMarkupSection) {
        if (anyChecked && allHaveMU) {
          globalMarkupSection.style.opacity = '0.5';
          globalMarkupSection.querySelector('.input-label').innerHTML = 'Global Markup (₹) <span style="color: var(--success); font-size: 0.8rem;">- Not required (all fares have MU)</span>';
        } else {
          globalMarkupSection.style.opacity = '1';
          globalMarkupSection.querySelector('.input-label').innerHTML = 'Global Markup (₹)';
        }
      }
    }

    function handleAddFareType(select, unitId, suffix = '') {
      const val = select.value;
      if (!val) return;

      let key = val;
      const cabinLabels = {
        'economy': 'Economy',
        'premium_economy': 'Premium Economy',
        'business': 'Business Class',
        'first': 'First Class'
      };

      let label = cabinLabels[val] || (val.charAt(0).toUpperCase() + val.slice(1).replace('_', ' ') + ' Fare');

      if (val === 'custom') {
        const customName = prompt("Enter Name for Custom Fare Type:");
        if (!customName || customName.trim() === '') {
          select.value = '';
          return;
        }
        label = customName.trim();
        key = label.toLowerCase().replace(/\s+/g, '_');
      }

      // Check if exists
      const uniqueKey = `${key}-unit-${unitId}${suffix}`;
      if (document.getElementById(`fare-card-${uniqueKey}`)) {
        showNotification('Fare type already exists', 'warning');
        select.value = '';
        return;
      }

      appendFareRow(unitId, key, label, suffix);
      select.value = '';
    }

    function appendFareRow(unitId, key, label, suffix = '') {
      const list = document.getElementById(`fare-list-${unitId}${suffix}`);
      const div = document.createElement('div');
      div.innerHTML = createFareCard(key, label, unitId, true, suffix);
      list.appendChild(div.firstElementChild);

      // Check if we need global markup
      updateGlobalMarkupRequirement();
    }

    function initializeUnitFares(unitId) {
      // Can add initialization logic here if needed
    }

    // ==================== FARE RULES AUTO-DETECT ====================

    /**
     * After parsing, detect airline codes from parsed flights and look up stored fare rules.
     * For each unit that has a matching rule, show a banner inside the fare section.
     */
    // Global store to hold rules pending application
    window.pendingFareRules = {};

    async function checkAndShowFareRuleSuggestions() {
      if (!currentFlights || currentFlights.length === 0) return;

      const unitAirlines = {};  // { unitId_suffix: airline_code }
      const unitFareTypes = {}; // { unitId_suffix: [fare_type_keys] }

      Object.entries(unitFlights).forEach(([unitId, flightIds]) => {
        const suffixes = ['', '_out', '_ret'];

        suffixes.forEach(suffix => {
          const listId = `fare-list-${unitId}${suffix}`;
          const fareCards = document.querySelectorAll(`#${listId} .fare-card`);
          if (fareCards.length === 0) return;

          let flightIdx = flightIds[0];
          if (suffix === '_ret' && flightIds.length > 1) flightIdx = flightIds[1];

          const flight = currentFlights[flightIdx];
          if (!flight) return;

          let airlineCode = '';
          const fn = flight.flight_number || '';
          const fnMatch = fn.match(/^([A-Z0-9]{2})\s/i);
          if (fnMatch) {
            airlineCode = fnMatch[1].toUpperCase();
          }
          if (!airlineCode && flight.airline) {
            const airlineName = (flight.airline || '').toLowerCase();
            const codeMap = window.AIRLINE_CODE_MAP || {};
            for (const [code, name] of Object.entries(codeMap)) {
              if (name.toLowerCase() === airlineName || airlineName.includes(name.toLowerCase())) {
                airlineCode = code;
                break;
              }
            }
          }
          if (!airlineCode) return;

          unitAirlines[`${unitId}${suffix}`] = airlineCode;

          const types = [];
          fareCards.forEach(card => {
            const chk = card.querySelector('.fare-card-header input[type="checkbox"]');
            if (chk && chk.checked) types.push(card.dataset.fareKey);
          });
          unitFareTypes[`${unitId}${suffix}`] = types;
        });
      });

      const allMatches = [];

      for (const [unitIdSuffix, airlineCode] of Object.entries(unitAirlines)) {
        const fareTypes = unitFareTypes[unitIdSuffix] || [];
        if (fareTypes.length === 0) continue;

        try {
          const res = await fetch('/api/fare-rules/lookup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ airline_code: airlineCode, fare_types: fareTypes })
          });
          if (!res.ok) continue;
          const data = await res.json();
          const matchedRules = data.fare_rules || {};
          if (Object.keys(matchedRules).length === 0) continue;

          window.pendingFareRules[unitIdSuffix] = matchedRules;

          const chipParts = [];
          for (const [fareType, rule] of Object.entries(matchedRules)) {
            const displayName = rule.fare_display_name || fareType;
            chipParts.push(`<span style="background:var(--bg-main); border:1px solid var(--border); padding:2px 6px; border-radius:4px; font-size:0.75rem;">${displayName}</span>`);
          }

          const airlineName = Object.values(matchedRules)[0]?.airline_name || airlineCode;
          allMatches.push(`
            <div style="margin-bottom:12px; padding:12px; background:rgba(16, 185, 129, 0.05); border:1px solid rgba(16, 185, 129, 0.2); border-radius:8px;">
              <strong style="color:#059669; display:block; margin-bottom:6px;">✈️ ${airlineName} (${airlineCode}) for Option ${unitIdSuffix.replace('_', ' ')}</strong>
              <div style="display:flex; gap:6px; flex-wrap:wrap;">${chipParts.join('')}</div>
            </div>
          `);

        } catch (e) {
          console.error('Fare rules lookup error:', e);
        }
      }

      if (allMatches.length > 0) {
        showFareRulesPromptModal(allMatches.join(''));
      }
    }

    function showFareRulesPromptModal(contentHTML) {
      let modal = document.getElementById('fareRulesPromptModal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'fareRulesPromptModal';
        modal.className = 'modal-overlay';
        modal.innerHTML = `
          <div class="modal-content" style="max-width: 500px; padding: 24px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
              <h3 style="margin:0; font-family:'Outfit', sans-serif; font-size:1.2rem; color:var(--text-primary);">✨ Fare Rules Found</h3>
              <button onclick="dismissFareRulesPromptModal()" style="background:none; border:none; font-size:1.2rem; cursor:pointer; color:var(--text-secondary);">✕</button>
            </div>
            <p style="font-size:0.9rem; color:var(--text-secondary); margin-bottom:16px;">We found stored baggage and penalty rules for your selected flights. Would you like to map them to the fare cards automatically?</p>
            <div id="fr-prompt-content" style="max-height: 300px; overflow-y: auto;"></div>
            <div style="display:flex; justify-content:flex-end; gap:12px; margin-top:24px;">
              <button onclick="dismissFareRulesPromptModal()" style="padding: 0.5rem 1rem; border: 1px solid var(--border); background: var(--bg-main); border-radius: 6px; cursor: pointer; font-weight:600; color: var(--text-secondary);">Skip</button>
              <button onclick="applyAllPendingFareRules()" style="padding: 0.5rem 1rem; background: #10b981; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight:600;">✓ Apply All Rules</button>
            </div>
          </div>
        `;
        document.body.appendChild(modal);
      }
      document.getElementById('fr-prompt-content').innerHTML = contentHTML;
      modal.classList.add('is-active');
    }

    function dismissFareRulesPromptModal() {
      const modal = document.getElementById('fareRulesPromptModal');
      if (modal) modal.classList.remove('is-active');
      window.pendingFareRules = {}; // Clear pending
    }

    function applyAllPendingFareRules() {
      let appliedCount = 0;
      for (const [unitIdSuffix, matchedRules] of Object.entries(window.pendingFareRules)) {
        for (const [fareType, rule] of Object.entries(matchedRules)) {
          const uniqueKey = `${fareType}-unit-${unitIdSuffix}`;

          const setIfEmpty = (selector, value) => {
            if (!value) return;
            const input = document.querySelector(selector);
            if (input && !input.value.trim()) input.value = value;
          };

          setIfEmpty(`.fare-cabin-${uniqueKey}`, rule.baggage_cabin);
          setIfEmpty(`.fare-checkin-${uniqueKey}`, rule.baggage_checkin);
          setIfEmpty(`.fare-pcs-${uniqueKey}`, rule.baggage_pcs);
          setIfEmpty(`.fare-seat-${uniqueKey}`, rule.seat);
          setIfEmpty(`.fare-meal-${uniqueKey}`, rule.meal);
          setIfEmpty(`.fare-cancellation-${uniqueKey}`, rule.cancellation_charges);
          setIfEmpty(`.fare-penalty-${uniqueKey}`, rule.change_penalty);

          const detailsId = `fare-details-input-${uniqueKey}`;
          const detailsEl = document.getElementById(detailsId);
          if (detailsEl && detailsEl.style.display === 'none') {
            detailsEl.style.display = 'block';
            const icon = document.getElementById(`fare-toggle-icon-${detailsId}`);
            if (icon) icon.style.transform = 'rotate(180deg)';
          }
          appliedCount++;
        }
      }

      dismissFareRulesPromptModal();
      if (appliedCount > 0) {
        showNotification(`Successfully auto-filled ${appliedCount} fare card(s)!`, 'success');
      }
    }

    function buildFareRulesPromptMatchHTML(unitIdSuffix, airlineCode, matchedRules) {
      const fieldLabelMap = {
        baggage_cabin: 'Cabin',
        baggage_checkin: 'Check-in',
        baggage_pcs: 'Pieces',
        seat: 'Seat',
        meal: 'Meal',
        cancellation_charges: 'Cancel',
        change_penalty: 'Change'
      };

      const fareBlocks = Object.entries(matchedRules).map(([fareType, rule]) => {
        const displayName = rule.fare_display_name || fareType;
        const fieldEntries = Object.entries(fieldLabelMap)
          .map(([fieldKey, label]) => {
            const value = rule[fieldKey];
            if (!value) return '';
            return `
              <div class="fare-rules-prompt-field">
                <span class="fare-rules-prompt-field-label">${label}</span>
                <span class="fare-rules-prompt-field-value">${value}</span>
              </div>
            `;
          })
          .filter(Boolean)
          .join('');

        return `
          <div class="fare-rules-prompt-fare-card">
            <p class="fare-rules-prompt-fare-title">${displayName}</p>
            <div class="fare-rules-prompt-field-grid">${fieldEntries}</div>
          </div>
        `;
      });

      const airlineName = Object.values(matchedRules)[0]?.airline_name || airlineCode;
      return `
        <div class="fare-rules-prompt-item">
          <div class="fare-rules-prompt-item-head">
            <p class="fare-rules-prompt-airline">${airlineName} (${airlineCode})</p>
            <span class="fare-rules-prompt-context">Option ${unitIdSuffix.replace('_', ' ')}</span>
          </div>
          <div class="fare-rules-prompt-fares">${fareBlocks.join('')}</div>
        </div>
      `;
    }

    async function checkAndShowFareRuleSuggestions() {
      if (!currentFlights || currentFlights.length === 0) return;

      const unitAirlines = {};
      const unitFareTypes = {};
      const getFlightsForUnit = (unitId) => {
        const normalizedUnitId = normalizeUnitIdValue(unitId);
        return (currentFlights || [])
          .map((flight, index) => ({ flight, index }))
          .filter(({ flight }) => flight && normalizeUnitIdValue(flight.unit_id || flight.unitId || '') === normalizedUnitId);
      };

      Object.entries(unitFlights).forEach(([unitId, flightIds]) => {
        ['', '_out', '_ret'].forEach(suffix => {
          const fareCards = document.querySelectorAll(`#fare-list-${unitId}${suffix} .fare-card`);
          if (fareCards.length === 0) return;

          const flightsForUnit = getFlightsForUnit(unitId);
          let targetEntry = flightsForUnit[0] || null;
          if (suffix === '_ret' && flightsForUnit.length > 1) targetEntry = flightsForUnit[1];
          if (suffix === '_out' && flightsForUnit.length > 0) targetEntry = flightsForUnit[0];

          const flight = targetEntry ? targetEntry.flight : null;
          if (!flight) return;

          let airlineCode = '';
          const fnMatch = (flight.flight_number || '').match(/^([A-Z0-9]{2})\s/i);
          if (fnMatch) airlineCode = fnMatch[1].toUpperCase();

          if (!airlineCode && flight.airline) {
            const airlineName = String(flight.airline || '').toLowerCase();
            const codeMap = window.AIRLINE_CODE_MAP || {};
            for (const [code, name] of Object.entries(codeMap)) {
              const normalizedName = String(name || '').toLowerCase();
              if (normalizedName && (airlineName === normalizedName || airlineName.includes(normalizedName))) {
                airlineCode = code;
                break;
              }
            }
          }
          if (!airlineCode) return;

          unitAirlines[`${unitId}${suffix}`] = airlineCode;

          const types = [];
          fareCards.forEach(card => {
            const chk = card.querySelector('.fare-card-header input[type="checkbox"]');
            if (chk && chk.checked) types.push(card.dataset.fareKey);
          });
          unitFareTypes[`${unitId}${suffix}`] = types;
        });
      });

      const allMatches = [];
      window.pendingFareRules = {};

      for (const [unitIdSuffix, airlineCode] of Object.entries(unitAirlines)) {
        const fareTypes = unitFareTypes[unitIdSuffix] || [];
        if (fareTypes.length === 0) continue;

        try {
          const res = await fetch('/api/fare-rules/lookup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ airline_code: airlineCode, fare_types: fareTypes })
          });
          if (!res.ok) continue;

          const data = await res.json();
          const matchedRules = data.fare_rules || {};
          if (Object.keys(matchedRules).length === 0) continue;

          window.pendingFareRules[unitIdSuffix] = matchedRules;
          allMatches.push(buildFareRulesPromptMatchHTML(unitIdSuffix, airlineCode, matchedRules));
        } catch (e) {
          console.error('Fare rules lookup error:', e);
        }
      }

      if (allMatches.length > 0) {
        showFareRulesPromptModal(allMatches.join(''));
      }
    }

    function showFareRulesPromptModal(contentHTML) {
      let modal = document.getElementById('fareRulesPromptModal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'fareRulesPromptModal';
        modal.className = 'modal-overlay';
        modal.innerHTML = `
          <div class="modal-content fare-rules-prompt-modal">
            <div class="fare-rules-prompt-header">
              <div>
                <h3 class="fare-rules-prompt-title">Fare Rules Found</h3>
                <p class="fare-rules-prompt-subtitle">Stored baggage, meal, seat, cancellation, and change rules are ready. Apply them to the matched fare cards and refresh the itinerary instantly.</p>
              </div>
              <button type="button" class="fare-rules-prompt-close" onclick="dismissFareRulesPromptModal()" aria-label="Close">x</button>
            </div>
            <div id="fr-prompt-content" class="fare-rules-prompt-list"></div>
            <div class="fare-rules-prompt-actions">
              <button type="button" class="fare-rules-prompt-btn secondary" onclick="dismissFareRulesPromptModal()">Skip</button>
              <button type="button" class="fare-rules-prompt-btn primary" onclick="applyAllPendingFareRules()">Apply Rules</button>
            </div>
          </div>
        `;
        document.body.appendChild(modal);
      }
      document.getElementById('fr-prompt-content').innerHTML = contentHTML;
      modal.classList.add('is-active');
    }

    function getFareRuleTargetFlights(unitIdSuffix) {
      const unitIdSuffixText = String(unitIdSuffix || '');
      const [rawUnitId, suffix = ''] = unitIdSuffixText.split(/(_out|_ret)$/);
      const unitId = normalizeUnitIdValue(rawUnitId || unitIdSuffixText);
      const matchingFlights = (currentFlights || [])
        .map((flight, index) => ({ flight, index }))
        .filter(({ flight }) => flight && normalizeUnitIdValue(flight.unit_id || flight.unitId || '') === unitId);

      if (suffix === '_out') return matchingFlights.slice(0, 1);
      if (suffix === '_ret') return matchingFlights.slice(1, 2);
      return matchingFlights;
    }

    function mergeFareRuleIntoFlight(flight, fareType, rule) {
      if (!flight || !fareType || !rule) return false;

      if (!flight.fare_extra_details || typeof flight.fare_extra_details !== 'object') {
        flight.fare_extra_details = {};
      }

      const nextExtras = { ...(flight.fare_extra_details[fareType] || {}) };
      const ruleFields = {
        baggage_cabin: rule.baggage_cabin,
        baggage_checkin: rule.baggage_checkin,
        baggage_pcs: rule.baggage_pcs,
        seat: rule.seat,
        meal: rule.meal,
        cancellation_charges: rule.cancellation_charges,
        penalty_charges: rule.change_penalty
      };

      let changed = false;
      Object.entries(ruleFields).forEach(([field, value]) => {
        if (!value) return;
        if (String(nextExtras[field] || '').trim()) return;
        nextExtras[field] = value;
        changed = true;
      });

      if (!changed) return false;

      flight.fare_extra_details[fareType] = nextExtras;

      const fareKeys = Object.keys(flight.fares || {});
      if (fareKeys.length === 1 && fareKeys[0] === fareType) {
        flight.baggage_cabin = flight.baggage_cabin || nextExtras.baggage_cabin || '';
        flight.baggage_checkin = flight.baggage_checkin || nextExtras.baggage_checkin || '';
        flight.baggage_pcs = flight.baggage_pcs || nextExtras.baggage_pcs || '';
        flight.seat = flight.seat || nextExtras.seat || '';
        flight.meal = flight.meal || nextExtras.meal || '';
        flight.cancellation_charges = flight.cancellation_charges || nextExtras.cancellation_charges || '';
        flight.penalty_charges = flight.penalty_charges || nextExtras.penalty_charges || '';
      }

      return true;
    }

    function applyAllPendingFareRules() {
      let appliedCount = 0;

      for (const [unitIdSuffix, matchedRules] of Object.entries(window.pendingFareRules)) {
        const targetFlights = getFareRuleTargetFlights(unitIdSuffix);

        for (const [fareType, rule] of Object.entries(matchedRules)) {
          const uniqueKey = `${fareType}-unit-${unitIdSuffix}`;

          const setIfEmpty = (selector, value) => {
            if (!value) return;
            const input = document.querySelector(selector);
            if (input && !String(input.value || '').trim()) input.value = value;
          };

          setIfEmpty(`.fare-cabin-${uniqueKey}`, rule.baggage_cabin);
          setIfEmpty(`.fare-checkin-${uniqueKey}`, rule.baggage_checkin);
          setIfEmpty(`.fare-pcs-${uniqueKey}`, rule.baggage_pcs);
          setIfEmpty(`.fare-seat-${uniqueKey}`, rule.seat);
          setIfEmpty(`.fare-meal-${uniqueKey}`, rule.meal);
          setIfEmpty(`.fare-cancellation-${uniqueKey}`, rule.cancellation_charges);
          setIfEmpty(`.fare-penalty-${uniqueKey}`, rule.change_penalty);

          const detailsId = `fare-details-input-${uniqueKey}`;
          const detailsEl = document.getElementById(detailsId);
          if (detailsEl && detailsEl.style.display === 'none') {
            detailsEl.style.display = 'block';
            const icon = document.getElementById(`fare-toggle-icon-${detailsId}`);
            if (icon) icon.style.transform = 'rotate(180deg)';
          }

          targetFlights.forEach(({ flight }) => {
            if (mergeFareRuleIntoFlight(flight, fareType, rule)) {
              appliedCount++;
            }
          });
        }
      }

      dismissFareRulesPromptModal();
      if (appliedCount > 0) {
        renderResults(currentFlights);
        regenerateOutputText();
        showNotification(`Applied stored fare rules to ${appliedCount} fare selection${appliedCount === 1 ? '' : 's'}.`, 'success');
      } else {
        showNotification('Stored rules were already present, so nothing changed.', 'info');
      }
    }

    function addCityToUnit(unitId) {
      const cityCount = (unitFlightCounts[unitId] || 1) + 1;
      unitFlightCounts[unitId] = cityCount;
      const flightId = ++flightCount;

      if (!unitFlights[unitId]) {
        unitFlights[unitId] = [];
      }
      unitFlights[unitId].push(flightId);

      const container = document.querySelector(`#unit-${unitId}-flights`);
      const flightBox = document.createElement('div');
      flightBox.innerHTML = createFlightBox(flightId, `City ${cityCount}`);
      container.appendChild(flightBox.firstElementChild);
    }

    async function removeUnit(unitId) {
      const remainingUnits = document.querySelectorAll('.flight-unit');
      if (remainingUnits.length <= 1) {
        showNotification('You must have at least one option', 'warning');
        return;
      }

      const confirmed = await showDeleteModal('Remove Option', 'Are you sure you want to remove this Entire Option? All nested flights and fares will be lost.');
      if (!confirmed) return;

      const unit = document.querySelector(`[data-unit-id="${unitId}"]`) || document.getElementById(`unit-${unitId}`)?.closest('.flight-unit');
      if (unit) {
        unit.remove();
      }

      // Cleanup mappings
      delete unitFlights[unitId];
      delete unitFlightCounts[unitId];

      // Re-index remaining units' visual labels
      const currentUnits = document.querySelectorAll('.flight-unit');
      currentUnits.forEach((u, idx) => {
        const header = u.querySelector('.flight-unit-header h3');
        if (header) {
          header.textContent = `Option ${idx + 1}`;
        }
      });

      showNotification('Option removed', 'success');
    }

    function toggleUnitFare(checkbox, fareType, unitId) {
      const input = document.querySelector(`.fare-${fareType}-unit-${unitId}`);
      input.disabled = !checkbox.checked;
      if (!checkbox.checked) {
        input.value = '';
      }
    }


    // ==================== GDS MODE ====================
    let gdsActiveUnits = new Set(); // Track which units are in GDS mode

    function toggleGdsMode(unitId) {
      const btn = document.getElementById(`gds-toggle-${unitId}`);
      const gdsContainer = document.getElementById(`gds-input-container-${unitId}`);
      const unit = document.querySelector(`.flight-unit[data-unit-id="${unitId}"]`);
      if (!btn || !gdsContainer || !unit) return;

      const isActive = btn.checked;

      if (!isActive) {
        // Deactivate GDS mode
        gdsActiveUnits.delete(unitId);
        gdsContainer.style.display = 'none';

        // Show normal flight blocks
        unit.querySelectorAll('.flight-block').forEach(b => b.style.display = '');

        // Show fare split control if round trip
        const splitControl = unit.querySelector('.fare-split-control');
        if (splitControl) splitControl.style.display = '';

        // Switch back default fare to saver
        switchDefaultFareForUnit(unitId, 'saver');
      } else {
        // Activate GDS mode
        gdsActiveUnits.add(unitId);
        gdsContainer.style.display = 'block';

        // Hide normal flight blocks
        unit.querySelectorAll('.flight-block').forEach(b => b.style.display = 'none');

        // Hide fare split control if round trip (GDS handles legs automatically)
        const splitControl = unit.querySelector('.fare-split-control');
        if (splitControl) splitControl.style.display = 'none';

        // Switch default fare to economy
        switchDefaultFareForUnit(unitId, 'economy');
      }
    }

    function switchDefaultFareForUnit(unitId, fareType) {
      // Find the saver checkbox and the target fare type
      const fareList = document.getElementById(`fare-list-${unitId}`);
      if (!fareList) return;

      const saverCard = fareList.querySelector('[data-fare-key="saver"]');
      const saverChk = saverCard ? saverCard.querySelector('input[type="checkbox"]') : null;

      if (fareType === 'economy') {
        // Hide and uncheck saver
        if (saverCard) {
          saverCard.style.display = 'none';
          if (saverChk && saverChk.checked) {
            saverChk.checked = false;
            toggleFareCard(saverChk, 'saver', unitId, '');
          }
        }
        // Check if economy card exists, if not add it
        let econCard = fareList.querySelector('[data-fare-key="economy"]');
        if (!econCard) {
          appendFareRow(unitId, 'economy', 'Economy', '');
          econCard = fareList.querySelector('[data-fare-key="economy"]');
        }
        // Show and ensure economy is checked
        if (econCard) {
          econCard.style.display = 'block';
          const econChk = econCard.querySelector('input[type="checkbox"]');
          if (econChk && !econChk.checked) {
            econChk.checked = true;
            toggleFareCard(econChk, 'economy', unitId, '');
          }
        }
      } else if (fareType === 'saver') {
        // Show and Re-enable saver if it was unchecked by GDS mode
        if (saverCard) {
          saverCard.style.display = 'block';
          if (saverChk && !saverChk.checked) {
            saverChk.checked = true;
            toggleFareCard(saverChk, 'saver', unitId, '');
          }
        }

        // Hide and Uncheck economy
        const econCard = fareList.querySelector('[data-fare-key="economy"]');
        if (econCard) {
          econCard.style.display = 'none';
          const econChk = econCard.querySelector('input[type="checkbox"]');
          if (econChk && econChk.checked) {
            econChk.checked = false;
            toggleFareCard(econChk, 'economy', unitId, '');
          }
        }
      }
    }

    async function parseFlights() {
      if (isParsing) {
        showNotification('Parsing already in progress', 'warning');
        return;
      }

      const markup = document.getElementById("markup").value.trim();
      const serviceChargeInput = document.getElementById("serviceCharge").value.trim();

      // Validation - markup is optional, default to 0 if not entered
      const markupValue = markup === '' ? 0 : Number(markup);
      if (Number.isNaN(markupValue) || markupValue < 0) {
        showNotification('Please enter a valid markup amount', 'error');
        document.getElementById("markup").focus();
        return;
      }

      currentMarkup = markupValue;

      // Service Charge
      const svcValue = serviceChargeInput === '' ? 0 : Number(serviceChargeInput);
      currentServiceCharge = svcValue;
      currentGST = svcValue > 0 ? Math.round(svcValue * 0.18) : 0;

      let hasError = false;
      const flights = [];
      const flightTexturesByUnit = {}; // Map unit IDs to their flight texts and fares

      // Check if any markup or service charge is specified anywhere (per-fare or global)
      let hasAnyFee = (markupValue > 0) || (svcValue > 0);
      if (!hasAnyFee) {
        // Check for per-fare markups or service charges
        document.querySelectorAll('.fare-card').forEach(card => {
          const checkbox = card.querySelector('.fare-card-header input[type="checkbox"]');
          if (checkbox && checkbox.checked) {
            const fareKey = card.dataset.fareKey;
            const section = card.closest('.shared-fare-section');
            if (section) {
              const unitId = section.dataset.unitId;
              // Check for all possible suffixes (_out, _ret, or empty)
              const suffixes = ['', '_out', '_ret'];
              suffixes.forEach(suffix => {
                const uniqueKey = `${fareKey}-unit-${unitId}${suffix}`;
                const muInp = card.querySelector(`.mu-${uniqueKey}`);
                const svcInp = card.querySelector(`.svc-${uniqueKey}`);
                if ((muInp && muInp.value && muInp.value.trim() !== '' && Number(muInp.value) > 0) ||
                  (svcInp && svcInp.value && svcInp.value.trim() !== '' && Number(svcInp.value) > 0)) {
                  hasAnyFee = true;
                }
              });
            }
          }
        });
      }

      // Warn only if NO markup AND NO service charge anywhere
      if (!hasAnyFee) {
        const proceed = await showWarningModal('Are you sure you want to proceed without adding any markup or service charge?');
        if (!proceed) {
          document.getElementById('markup').focus();
          return;
        }
      }

      // Process each unit
      // IMPORTANT: flightUnits needs to be defined/collected correctly
      // Previously, we iterate through unitFlights to build flights. 
      // Actually, looking at code in 2388+, we iterate Object.entries(unitFlights).

      Object.entries(unitFlights).forEach(([unitId, flightIds]) => {
        // Check if this unit is in GDS mode
        if (gdsActiveUnits.has(Number(unitId))) {
          const gdsTextarea = document.getElementById(`gds-textarea-${unitId}`);
          const gdsText = gdsTextarea ? gdsTextarea.value.trim() : '';
          if (!gdsText) {
            showNotification(`Please paste GDS text for Option ${unitId}`, 'error');
            if (gdsTextarea) gdsTextarea.focus();
            hasError = true;
            return;
          }

          // Collect fares for this unit (same logic as normal mode)
          const collectGdsFares = (suffix) => {
            const fares = {};
            const mus = {};
            const svcs = {};
            const fareExtras = {};
            const fareOrder = [];
            const fareLabels = {};
            const fareCards = document.querySelectorAll(`#fare-list-${unitId}${suffix} .fare-card`);

            fareCards.forEach(card => {
              const checkbox = card.querySelector('.fare-card-header input[type="checkbox"]');
              if (!checkbox || !checkbox.checked) return;
              const fareKey = card.dataset.fareKey;
              const uniqueKey = `${fareKey}-unit-${unitId}${suffix}`;
              const fareLabel = (card.querySelector('.fare-card-header label')?.textContent || fareKey).trim();
              fareOrder.push(fareKey);
              fareLabels[fareKey] = fareLabel;
              const fareInput = card.querySelector(`.fare-${uniqueKey}`);
              const muInput = card.querySelector(`.mu-${uniqueKey}`);
              const svcInput = card.querySelector(`.svc-${uniqueKey}`);

              // Collecting extra fields per fare
              const cabinInp = card.querySelector(`.fare-cabin-${uniqueKey}`);
              const checkinInp = card.querySelector(`.fare-checkin-${uniqueKey}`);
              const pcsInp = card.querySelector(`.fare-pcs-${uniqueKey}`);
              const seatInp = card.querySelector(`.fare-seat-${uniqueKey}`);
              const mealInp = card.querySelector(`.fare-meal-${uniqueKey}`);
              const cancelInp = card.querySelector(`.fare-cancellation-${uniqueKey}`);
              const penInp = card.querySelector(`.fare-penalty-${uniqueKey}`);

              if (fareInput && fareInput.value && fareInput.value.trim() !== '') {
                fares[fareKey] = Number(fareInput.value);
              }
              if (muInput && muInput.value && muInput.value.trim() !== '') {
                mus[fareKey] = Number(muInput.value);
              }
              if (svcInput && svcInput.value && svcInput.value.trim() !== '') {
                svcs[fareKey] = Number(svcInput.value);
              }

              // Only store extra if at least one field is filled
              if (cabinInp?.value || checkinInp?.value || pcsInp?.value || seatInp?.value || mealInp?.value || cancelInp?.value || penInp?.value) {
                fareExtras[fareKey] = {
                  baggage_cabin: cabinInp?.value?.trim(),
                  baggage_checkin: checkinInp?.value?.trim(),
                  baggage_pcs: pcsInp?.value?.trim(),
                  seat: seatInp?.value?.trim(),
                  meal: mealInp?.value?.trim(),
                  cancellation_charges: cancelInp?.value?.trim(),
                  penalty_charges: penInp?.value?.trim()
                };
              }
            });

            if (Object.keys(fares).length === 0) {
              // It's fine, we will let the backend handle it or default to 0
            }
            return { fares, mus, svcs, fareExtras, fareOrder, fareLabels };
          };

          const gdsFareData = collectGdsFares('');

          // Store GDS unit data for processing after the loop
          flightTexturesByUnit[unitId] = [gdsText];

          // Push a special GDS marker flight entry
          flights.push({
            text: gdsText,
            fares: gdsFareData.fares,
            fare_mu: gdsFareData.mus,
            fare_svc: gdsFareData.svcs,
            fare_extra_details: gdsFareData.fareExtras,
            fare_order: gdsFareData.fareOrder,
            fare_labels: gdsFareData.fareLabels,
            has_layover: true,
            is_multiple: false,
            is_split: false,
            is_gds: true,
            unitId: unitId
          });
          return; // Skip normal flight processing for this unit
        }

        // Helper to collect fares from a specific list (suffix)
        const collectFares = (suffix) => {
          const fares = {};
          const mus = {};
          const svcs = {};
          const fareExtras = {}; // New object for extra details
          const fareOrder = [];
          const fareLabels = {};
          const fareCards = document.querySelectorAll(`#fare-list-${unitId}${suffix} .fare-card`);

          let localError = false;

          fareCards.forEach(card => {
            const checkbox = card.querySelector('.fare-card-header input[type="checkbox"]');
            if (!checkbox || !checkbox.checked) return;

            const fareKey = card.dataset.fareKey;
            const uniqueKey = `${fareKey}-unit-${unitId}${suffix}`;
            const fareLabel = (card.querySelector('.fare-card-header label')?.textContent || fareKey).trim();
            fareOrder.push(fareKey);
            fareLabels[fareKey] = fareLabel;

            const fareInput = card.querySelector(`.fare-${uniqueKey}`);
            const muInput = card.querySelector(`.mu-${uniqueKey}`);
            const svcInput = card.querySelector(`.svc-${uniqueKey}`);

            // Collecting extra fields per fare
            const cabinInp = card.querySelector(`.fare-cabin-${uniqueKey}`);
            const checkinInp = card.querySelector(`.fare-checkin-${uniqueKey}`);
            const pcsInp = card.querySelector(`.fare-pcs-${uniqueKey}`);
            const seatInp = card.querySelector(`.fare-seat-${uniqueKey}`);
            const mealInp = card.querySelector(`.fare-meal-${uniqueKey}`);
            const cancelInp = card.querySelector(`.fare-cancellation-${uniqueKey}`);
            const penInp = card.querySelector(`.fare-penalty-${uniqueKey}`);

            if (fareKey === 'saver') {
              if (fareInput && fareInput.value && fareInput.value.trim() !== '') {
                fares[fareKey] = Number(fareInput.value);
              } else {
                fares[fareKey] = null; // Auto-extract
              }
            } else {
              if (!fareInput || !fareInput.value || fareInput.value.trim() === '' || Number(fareInput.value) < 0) {
                const label = card.querySelector('.fare-card-header label')?.textContent || fareKey;
                showNotification(`Please enter amount for ${label} in Option ${unitId}`, 'error');
                if (fareInput) fareInput.focus();
                localError = true;
                hasError = true;
              } else {
                fares[fareKey] = Number(fareInput.value);
              }
            }

            if (muInput && muInput.value && muInput.value.trim() !== '') {
              mus[fareKey] = Number(muInput.value);
            }
            if (svcInput && svcInput.value && svcInput.value.trim() !== '') {
              svcs[fareKey] = Number(svcInput.value);
            }

            // Only store extra if at least one field is filled
            if (cabinInp?.value || checkinInp?.value || pcsInp?.value || seatInp?.value || mealInp?.value || cancelInp?.value || penInp?.value) {
              fareExtras[fareKey] = {
                baggage_cabin: cabinInp?.value?.trim(),
                baggage_checkin: checkinInp?.value?.trim(),
                baggage_pcs: pcsInp?.value?.trim(),
                seat: seatInp?.value?.trim(),
                meal: mealInp?.value?.trim(),
                cancellation_charges: cancelInp?.value?.trim(),
                penalty_charges: penInp?.value?.trim()
              };
            }
          });

          // Check if at least one fare is selected (if saver not auto-selected)
          // Simplified: If no fares and no saver checked, error.
          // Actually, we rely on the loop above. If fares is empty and 'saver' is not in checked cards...
          // But we iterate over *selected* cards.
          // So just check if fares is empty.
          // However, we need to know if saver was checked.
          // If completely empty -> Error.
          if (Object.keys(fares).length === 0) {
            // Exception: User might want to proceed without fares? 
            // Existing logic allowed proceeding if saver was checked (auto-extract).
            // My logic above adds 'saver': null if checked. So it won't be empty.
            // If completely empty -> Error.
            showNotification(`Please select at least one fare type for Option ${unitId}`, 'error');
            localError = true;
            hasError = true;
          }

          return { fares, mus, svcs, fareExtras, fareOrder, fareLabels, error: localError };
        };

        const isSplit = document.getElementById(`split-fares-toggle-${unitId}`)?.checked;
        let outboundData = null;
        let returnData = null;
        let sharedData = null;

        if (isSplit && flightIds.length === 2) {
          outboundData = collectFares('_out');
          returnData = collectFares('_ret');
          // If error, hasError is already true
        } else {
          sharedData = collectFares('');
        }

        flightIds.forEach((flightId, idx) => {
          const block = document.querySelector(`[data-flight-id="${flightId}"]`);
          if (!block) return;

          const text = block.querySelector("textarea").value.trim();
          const hasLayover = block.querySelector(".layover-checkbox")?.checked || false;
          const isMultiple = block.querySelector(".multiple-flights-checkbox")?.checked || false;

          if (!text) {
            showNotification(`Please paste flight details for flight #${flightId}`, 'error');
            hasError = true;
            return;
          }

          let faresToUse = {};
          let muToUse = {};
          let svcToUse = {};
          let extrasToUse = {};
          let fareOrderToUse = [];
          let fareLabelsToUse = {};

          if (isSplit && flightIds.length === 2) {
            if (idx === 0 && outboundData) { // Outbound
              faresToUse = outboundData.fares;
              muToUse = outboundData.mus;
              svcToUse = outboundData.svcs;
              extrasToUse = outboundData.fareExtras;
              fareOrderToUse = outboundData.fareOrder || [];
              fareLabelsToUse = outboundData.fareLabels || {};
            } else if (idx === 1 && returnData) { // Return
              faresToUse = returnData.fares;
              muToUse = returnData.mus;
              svcToUse = returnData.svcs;
              extrasToUse = returnData.fareExtras;
              fareOrderToUse = returnData.fareOrder || [];
              fareLabelsToUse = returnData.fareLabels || {};
            }
          } else if (sharedData) {
            faresToUse = sharedData.fares;
            muToUse = sharedData.mus;
            svcToUse = sharedData.svcs;
            extrasToUse = sharedData.fareExtras;
            fareOrderToUse = sharedData.fareOrder || [];
            fareLabelsToUse = sharedData.fareLabels || {};
          }

          flightTexturesByUnit[unitId] = flightTexturesByUnit[unitId] || [];
          flightTexturesByUnit[unitId].push(text);

          flights.push({
            text: text,
            fares: faresToUse,
            fare_mu: muToUse,
            fare_svc: svcToUse,
            fare_extra_details: extrasToUse,
            fare_order: fareOrderToUse,
            fare_labels: fareLabelsToUse,
            has_layover: hasLayover,
            is_multiple: isMultiple,
            is_split: isSplit, // Track if unit was split
            unitId: unitId
          });
        });
      });

      if (hasError || flights.length === 0) {
        return;
      }

      // Pre-validation for layover flights - prompt user if info seems incomplete
      for (const flight of flights) {
        if (flight.has_layover) {
          const text = flight.text.toLowerCase();

          // Check for minimum layover indicators
          const hasMultipleTimes = (text.match(/\d{1,2}[:\.]?\d{2}\s*(am|pm)?/gi) || []).length >= 4;
          const hasMultipleCities = (text.match(/\b[A-Z]{3}\b/g) || []).length >= 3;
          const hasLayoverKeywords = /layover|via|connect|stop|transit/i.test(text);

          if (!hasMultipleTimes && !hasMultipleCities && !hasLayoverKeywords) {
            const shouldContinue = confirm(
              `⚠️ Layover Flight Info Check\n\n` +
              `The layover checkbox is checked, but we couldn't detect:\n` +
              `• Multiple departure/arrival times (need at least 4)\n` +
              `• Multiple airport codes (need at least 3)\n` +
              `• Layover keywords (via, connecting, transit)\n\n` +
              `For accurate layover parsing, please ensure your text includes:\n` +
              `• Each segment's departure and arrival times\n` +
              `• Each segment's departure and arrival cities/airports\n` +
              `• Layover city and duration (if known)\n\n` +
              `Click OK to continue anyway, or Cancel to edit the input.`
            );

            if (!shouldContinue) {
              return;
            }
          }
        }
      }

      // Start parsing
      isParsing = true;
      const parseBtn = document.getElementById('parseBtn');
      const parseIcon = document.getElementById('parseIcon');
      const parseBtnText = document.getElementById('parseBtnText');

      parseBtn.disabled = true;
      parseIcon.innerHTML = '<span class="loading"></span>';
      parseBtnText.textContent = 'Processing...';

      document.getElementById("cards").innerHTML = '';
      document.getElementById("cardsSection").style.display = 'none';
      document.getElementById("outputSection").style.display = 'none';
      pendingCabinSelections = {};
      activeCabinEditorFlights = new Set();

      try {
        // Handle GDS mode flights separately
        const gdsFlights = flights.filter(f => f.is_gds);
        const normalFlights = flights.filter(f => !f.is_gds);
        let allParsedFlights = [];

        // Process GDS flights first
        for (const gdsFlight of gdsFlights) {
          try {
            const gdsResp = await fetch("/api/parse-gds", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ text: gdsFlight.text })
            });
            const gdsData = await gdsResp.json();
            if (!gdsResp.ok) {
              showNotification(gdsData.error || 'Failed to parse GDS text', 'error');
              isParsing = false;
              parseBtn.disabled = false;
              parseIcon.innerHTML = '&#10024;';
              parseBtnText.textContent = 'Parse Flights';
              return;
            }
            // Apply fares/markup to each parsed GDS flight
            (gdsData.flights || []).forEach(flight => {
              flight.fares = gdsFlight.fares || {};
              flight.markup = Number(markup);
              flight.fare_mu = gdsFlight.fare_mu || {};
              flight.fare_svc = gdsFlight.fare_svc || {};
              flight.fare_extra_details = gdsFlight.fare_extra_details || {};
              flight.fare_order = gdsFlight.fare_order || [];
              flight.fare_labels = gdsFlight.fare_labels || {};
              flight.service_charge = svcValue;
              flight.gst = svcValue > 0 ? Math.round(svcValue * 0.18) : 0;
              flight.is_editable = true;
              flight.unitId = gdsFlight.unitId;
              // Remove saver_fare if present (it's in fares now)
              if (flight.saver_fare !== undefined) {
                if (!flight.fares.economy && flight.saver_fare) {
                  flight.fares.economy = flight.saver_fare;
                }
                delete flight.saver_fare;
              }
              if (Object.keys(flight.fares).length === 0) {
                flight.fares = { economy: 0 };
              }
              allParsedFlights.push(flight);
            });
          } catch (e) {
            console.error('GDS parse error:', e);
            showNotification('GDS parsing failed: ' + e.message, 'error');
            isParsing = false;
            parseBtn.disabled = false;
            parseIcon.innerHTML = '&#10024;';
            parseBtnText.textContent = 'Parse Flights';
            return;
          }
        }

        // If there are no normal flights, skip the /parse call
        if (normalFlights.length === 0 && allParsedFlights.length > 0) {
          // Skip to rendering with GDS-parsed flights
          const data = { flights: allParsedFlights };
          (data.flights || []).forEach(flight => {
            if (!flight || typeof flight !== 'object') return;
            flight.show_cabin_class = false;
            (flight.segments || []).forEach(segment => {
              if (!segment || typeof segment !== 'object') return;
              segment.show_booking_class = false;
            });
          });

          // Build unitFlights mapping for GDS results
          const gdsUnitMap = {};
          let gdsIdx = 0;
          for (const gdsFlight of gdsFlights) {
            const uid = gdsFlight.unitId;
            gdsUnitMap[uid] = gdsUnitMap[uid] || [];
            // Count how many flights this GDS unit produced
            const gdsResp2 = data.flights.filter(f => f.unitId === uid);
            gdsResp2.forEach(() => {
              gdsUnitMap[uid].push(gdsIdx);
              gdsIdx++;
            });
          }
          unitFlights = gdsUnitMap;

          currentFlights = applyUnitMetadataToFlights(data.flights);

          // Handle fare_order and fare_labels
          for (const gdsFlight of gdsFlights) {
            const uid = gdsFlight.unitId;
            const idxArr = gdsUnitMap[uid] || [];
            idxArr.forEach(i => {
              if (currentFlights[i]) {
                currentFlights[i].fare_order = gdsFlight.fare_order;
                currentFlights[i].fare_labels = gdsFlight.fare_labels;
              }
            });
          }

          renderResults(currentFlights);
          checkAndShowFareRuleSuggestions();
          isParsing = false;
          parseBtn.disabled = false;
          parseIcon.innerHTML = '&#10024;';
          parseBtnText.textContent = 'Parse Flights';
          return;
        }

        // Send flight texts and their selected fares
        // If saver is checked but empty, parser will try to extract it from text
        const response = await fetch("/parse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            flights: flights.map(f => f.text),
            fares: flights.map(f => f.fares), // Send user-selected fares for each flight
            fare_mu: flights.map(f => f.fare_mu || {}),  // Per-fare markups
            fare_svc: flights.map(f => f.fare_svc || {}), // Per-fare service charges
            fare_extra_details: flights.map(f => f.fare_extra_details || {}), // Per-fare extra details
            layover_flags: flights.map(f => f.has_layover),
            multiple_flight_flags: flights.map(f => f.is_multiple),
            markup: Number(markup),
            global_svc: svcValue
          })
        });

        const data = await response.json();

        // If the LLM failed but fallback succeeded, we want to warn the user but STILL render the ticket
        if (data.flights && Array.isArray(data.flights)) {
          if (data.flights.some(f => f.llm_error === true)) {
            showLLMErrorModal();
          }
        }

        if (!response.ok) {
          showNotification(data.error || 'Failed to parse flights', 'error');
          return;
        }

        (data.flights || []).forEach(flight => {
          if (!flight || typeof flight !== 'object') return;
          flight.show_cabin_class = false;
          (flight.segments || []).forEach(segment => {
            if (!segment || typeof segment !== 'object') return;
            segment.show_booking_class = false;
          });
        });

        // Update the saver fare inputs with extracted values if any
        let flightIndex = 0;
        Object.entries(unitFlights).forEach(([unitId, flightIds]) => {
          let extractedSaverFare = null;

          // Check if any flight in this unit has extracted saver fare
          for (let i = 0; i < flightIds.length; i++) {
            if (flightIndex + i < data.flights.length) {
              const flight = data.flights[flightIndex + i];
              // Check if saver fare was extracted or provided
              if (flight.fares && flight.fares.saver) {
                extractedSaverFare = flight.fares.saver;
                break;
              }
            }
          }

          // If we found a saver fare and the input is empty, auto-fill it
          if (extractedSaverFare) {
            const saverInput = document.querySelector(`.fare-saver-unit-${unitId}`);
            if (saverInput && (!saverInput.value || saverInput.value.trim() === '')) {
              saverInput.value = extractedSaverFare;
              showNotification(`Auto-filled Saver Fare (₹${extractedSaverFare.toLocaleString('en-IN')}) for Option ${unitId}`, 'success');
            }
          }

          flightIndex += flightIds.length;
        });

        // Apply SVC and GST to all flights
        data.flights.forEach(f => {
          f.service_charge = currentServiceCharge;
          f.gst = currentGST;
        });

        // Promote single-fare extras and split flag to results
        data.flights.forEach((f, i) => {
          const userFlight = flights[i];
          if (userFlight) {
            f.is_split = userFlight.is_split; // Propagate split flag
            if (userFlight.fare_extra_details) {
              const fareKeys = Object.keys(userFlight.fares || {});
              if (fareKeys.length === 1) {
                const singleFareType = fareKeys[0];
                const extras = userFlight.fare_extra_details[singleFareType];
                if (extras) {
                  // Copy properties to the main flight object for timeline rendering
                  f.baggage_cabin = extras.baggage_cabin || f.baggage_cabin;
                  f.baggage_checkin = extras.baggage_checkin || f.baggage_checkin;
                  f.baggage_pcs = extras.baggage_pcs || f.baggage_pcs;
                  f.meal = extras.meal || f.meal;
                  f.seat = extras.seat || f.seat;
                  f.cancellation_charges = extras.cancellation_charges || f.cancellation_charges;
                  f.penalty_charges = extras.penalty_charges || f.penalty_charges;
                }
              }
            }
          }
        });

        currentFlights = applyUnitMetadataToFlights(data.flights);
        // Reset edit mode to false by default for new parse results
        isGlobalEditMode = false;
        renderResults(data.flights);
        checkAndShowFareRuleSuggestions();
        showNotification('Flights parsed successfully!', 'success');

      } catch (error) {
        showNotification('Error parsing flights. Please try again.', 'error');
        console.error(error);
      } finally {
        isParsing = false;
        parseBtn.disabled = false;
        parseIcon.innerHTML = '🚀';
        parseBtnText.textContent = 'Parse Flights & Generate Itinerary';
      }
    }

    function renderResults(flights, onlyUpdatePassengers = false) {
      if (!flights || flights.length === 0) {
        return;
      }

      // Collect all parse errors for a global notification
      const allErrorsSet = new Set();
      flights.forEach(f => {
        if (f.parse_errors) {
          f.parse_errors.forEach(err => allErrorsSet.add(err));
        }
      });
      if (allErrorsSet.size > 0) {
        const consolidatedErrors = Array.from(allErrorsSet).join(' • ');
        showNotification(`Input Issue Detected: ${consolidatedErrors}`, 'warning');
      }

      // Show sections
      document.getElementById("cardsSection").style.display = 'block';
      document.getElementById("outputSection").style.display = 'block';

      // Render cards with unit grouping
      const cardsContainer = document.getElementById("cards");
      cardsContainer.innerHTML = '';

      // Check if any flight is editable - show global edit controls
      const hasEditableFlights = flights.some(f => f.is_editable);
      const globalEditControls = document.getElementById('globalEditControls');
      if (hasEditableFlights) {
        globalEditControls.style.display = 'flex';
        globalEditControls.style.gap = '0.5rem';

        // Update button state to reflect current mode
        const globalEditBtn = document.getElementById('globalEditBtn');
        if (isGlobalEditMode) {
          globalEditBtn.innerHTML = '✕ Cancel Edit';
          globalEditBtn.classList.add('active');
        } else {
          globalEditBtn.innerHTML = '✏️ Edit Fares';
          globalEditBtn.classList.remove('active');
        }
      } else {
        globalEditControls.style.display = 'none';
        isGlobalEditMode = false;
      }

      // Group flights by unit for display
      let flightIndex = 0;
      Object.entries(unitFlights).forEach(([unitId, flightIds]) => {
        if (currentTripType === 'round_trip' || currentTripType === 'multi_city') {
          const unitContainer = document.createElement('div');
          unitContainer.style.marginBottom = '2rem';
          unitContainer.style.width = '100%';

          const unitHeader = document.createElement('h4');
          unitHeader.style.marginBottom = '1rem';
          unitHeader.style.color = 'var(--primary)';
          unitHeader.style.paddingBottom = '0.5rem';
          unitHeader.style.borderBottom = '2px solid var(--primary)';
          unitHeader.textContent = (currentTripType === 'round_trip' ? 'Round Trip Option ' : 'Multi-City Option ') + unitId;
          unitContainer.appendChild(unitHeader);

          const cardsWrapper = document.createElement('div');
          cardsWrapper.className = 'cards-wrapper';

          // For round trip, we want to combine 2 flights into one card if possible
          if (currentTripType === 'round_trip' && flightIds.length === 2) {
            const outbound = flights[flightIndex];
            const returnFlight = flights[flightIndex + 1];
            if (outbound && returnFlight) {
              const combinedCard = createRoundTripCardWithEditButton(outbound, returnFlight, flightIndex, unitId);
              cardsWrapper.appendChild(combinedCard);
              flightIndex += 2;
            }
          } else if (currentTripType === 'multi_city') {
            // Multi-City Combined Card
            const optionFlights = flights.slice(flightIndex, flightIndex + flightIds.length);
            if (optionFlights.length > 0) {
              const combinedCard = createMultiCityCardWithEditButton(optionFlights, flightIndex, unitId);
              cardsWrapper.appendChild(combinedCard);
              flightIndex += flightIds.length;
            }
          } else {
            // Malformed data fallback: render individual cards
            flightIds.forEach(() => {
              if (flightIndex < flights.length) {
                const flight = flights[flightIndex];
                const card = createCardWithEditButton(flight, flightIndex);
                cardsWrapper.appendChild(card);
                flightIndex++;
              }
            });
          }

          unitContainer.appendChild(cardsWrapper);
          cardsContainer.appendChild(unitContainer);
        } else {
          // One Way
          if (unitId === Object.keys(unitFlights)[0]) {
            for (let fi = 0; fi < flights.length; fi++) {
              cardsContainer.appendChild(createCardWithEditButton(flights[fi], fi));
            }
            flightIndex = flights.length;
          }
        }
      });

      // Render output text using the consolidated logic
      regenerateOutputText(onlyUpdatePassengers);
      scheduleCardsImagePreload();

      // Scroll to results
      document.getElementById("cardsSection").scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function isFieldValid(val) {
      if (!val) return false;
      const s = String(val).trim().toLowerCase();
      return s !== '' && s !== 'n/a' && s !== 'null' && s !== 'undefined' && s !== 'unknown' && s !== 'not specified';
    }

    function getTimeCategory(timeStr) {
      if (!timeStr || timeStr === 'N/A') return '';
      const parts = timeStr.split(':');
      if (parts.length < 2) return '';

      const hour = parseInt(parts[0], 10);

      if (hour >= 0 && hour < 6) return 'Early Morning Flight';
      if (hour >= 6 && hour < 12) return 'Morning Flight';
      if (hour >= 12 && hour < 16) return 'Afternoon Flight';
      if (hour >= 16 && hour < 21) return 'Evening Flight';
      if (hour >= 21) return 'Night Flight';

      return '';
    }

    function generateFlightSummaryHTML(flight, index, uniqueId) {
      // Helper to safely display values - never show undefined, null, N/A
      const safe = (val, fallback = '') => {
        if (val === undefined || val === null || val === 'N/A' || val === 'Not Specified' || val === 'undefined' || val === 'null') {
          return fallback;
        }
        return val;
      };

      const cabinOptions = [
        { value: '', label: 'None' },
        { value: 'economy', label: 'Economy' },
        { value: 'premium_economy', label: 'Premium Economy' },
        { value: 'business', label: 'Business Class' },
        { value: 'first', label: 'First Class' }
      ];

      const normalizeCabinClass = (value) => {
        const raw = safe(value, '').toString().trim().toLowerCase();
        if (!raw || raw === 'none' || raw === 'n/a') return '';
        if (raw.includes('premium')) return 'premium_economy';
        if (raw.includes('business')) return 'business';
        if (raw.includes('first')) return 'first';
        if (raw.includes('economy')) return 'economy';
        return '';
      };

      const cabinLabel = (value) => {
        const normalized = normalizeCabinClass(value);
        if (!normalized) return '';
        const match = cabinOptions.find(option => option.value === normalized);
        return match ? match.label : 'Economy';
      };

      const cabinClassName = (value) => {
        const normalized = normalizeCabinClass(value);
        return normalized ? `cabin-${normalized}` : '';
      };

      const cabinInlineStyle = (value) => {
        const normalized = normalizeCabinClass(value);
        const styles = {
          economy: 'background:rgba(37,99,235,0.08) !important;border:1px solid rgba(37,99,235,0.18) !important;color:#1d4ed8 !important;',
          premium_economy: 'background:rgba(147,51,234,0.08) !important;border:1px solid rgba(147,51,234,0.18) !important;color:#7e22ce !important;',
          business: 'background:rgba(234,179,8,0.14) !important;border:1px solid rgba(202,138,4,0.28) !important;color:#a16207 !important;',
          first: 'background:rgba(22,163,74,0.08) !important;border:1px solid rgba(22,163,74,0.18) !important;color:#15803d !important;'
        };
        return styles[normalized] || '';
      };

      const getCabinSelectionKey = (segmentIndex = null) => `${index}:${segmentIndex === null ? 'flight' : segmentIndex}`;
      const isCabinSaved = (segmentIndex = null) => {
        if (segmentIndex !== null && segmentIndex !== undefined) {
          const segment = flight.segments && flight.segments[segmentIndex];
          return !!(segment && segment.show_booking_class && normalizeCabinClass(segment.cabin_class || segment.class_of_travel));
        }
        return !!(flight.show_cabin_class && normalizeCabinClass(flight.class_of_travel || flight.cabin_class));
      };
      const getSavedCabinValue = (segmentIndex = null) => {
        if (segmentIndex !== null && segmentIndex !== undefined) {
          const segment = flight.segments && flight.segments[segmentIndex];
          if (!segment || !segment.show_booking_class) return '';
          return segment.cabin_class || segment.class_of_travel || '';
        }
        if (!flight.show_cabin_class) return '';
        return flight.class_of_travel || flight.cabin_class || '';
      };
      const getEditingCabinValue = (segmentIndex = null) => {
        const pendingKey = getCabinSelectionKey(segmentIndex);
        if (Object.prototype.hasOwnProperty.call(pendingCabinSelections, pendingKey)) {
          return pendingCabinSelections[pendingKey];
        }
        return normalizeCabinClass(getSavedCabinValue(segmentIndex));
      };

      const renderCabinControl = (segmentIndex = null) => {
        const isEditing = isGlobalEditMode && flight.is_editable && activeCabinEditorFlights.has(index);
        const normalized = getEditingCabinValue(segmentIndex);
        if (!isEditing) {
          if (!normalized || normalized === 'none') return '';
          return `<span class="cabin-pill ${cabinClassName(normalized)}" style="${cabinInlineStyle(normalized)}">${cabinLabel(normalized)}</span>`;
        }
        const onChangeArgs = segmentIndex === null ? `${index}, null, this.value` : `${index}, ${segmentIndex}, this.value`;
        return `
          <span class="cabin-select-wrap" onclick="event.stopPropagation()">
            <select class="cabin-select" onclick="event.stopPropagation()" onchange="updateFlightCabinClass(${onChangeArgs})">
              ${cabinOptions.map(option => `<option value="${option.value}" ${option.value === normalized ? 'selected' : ''}>${option.label}</option>`).join('')}
            </select>
          </span>
        `;
      };

      const airlineName = safe(flight.airline, 'Airline');
      const flightNumber = safe(flight.flight_number, '');
      const depTime = safe(flight.departure_time, '--:--');
      const arrTime = safe(flight.arrival_time, '--:--');
      const depCity = safe(flight.departure_city, '');
      const arrCity = safe(flight.arrival_city, '');
      const depAirport = safe(flight.departure_airport, '');
      const arrAirport = safe(flight.arrival_airport, '');
      const duration = safe(flight.duration, '--');
      const daysOffset = flight.days_offset || 0;
      const hasSegments = flight.segments && flight.segments.length > 0;
      const displayStops = safe(flight.stops, hasSegments ? `${flight.segments.length - 1} Stop(s)` : 'Direct');
      const isDirect = displayStops.toLowerCase().includes('non-stop') || displayStops.toLowerCase().includes('direct') || (flight.segments && flight.segments.length <= 1);
      const isMissingDate = !flight.departure_date || flight.departure_date === 'N/A';
      const hasSavedCabinDisplay = (hasSegments && !isDirect)
        ? (flight.segments || []).some((seg) => seg && seg.show_booking_class && normalizeCabinClass(seg.cabin_class || seg.class_of_travel))
        : (!!flight.show_cabin_class && !!normalizeCabinClass(flight.class_of_travel || flight.cabin_class));

      // Helper for city display
      const formatCity = (city, airport) => {
        if (!city) return airport || '';
        if (airport && city.includes(airport)) return city;
        if (airport && city.trim() === airport.trim()) return city;
        return `${city} <span class="airport-code-small">(${airport || ''})</span>`;
      };

      return `
        <div class="flight-summary ${hasSavedCabinDisplay ? 'has-cabin-display' : ''}" onclick="toggleDetails('${uniqueId}')">
            <div class="summary-main ${hasSavedCabinDisplay ? 'has-cabin-display' : ''}">
                <div class="summary-airline ${hasSavedCabinDisplay ? 'has-cabin-display' : ''}">
                    <div class="airline-stack">
                        ${(hasSegments && !isDirect)
          ? flight.segments.map((s, segIdx) => `
                              <div class="airline-row">
                                <div class="airline-row-main">
                                  <span class="airline-name-small">${safe(s.airline, 'Airline')}</span>
                                  <span class="flight-code-small">${safe(s.flight_number, '')}</span>
                                  ${renderCabinControl(segIdx)}
                                </div>
                              </div>
                            `).join('')
          : `
                              <div class="airline-row">
                                <div class="airline-row-main">
                                  <span class="airline-name">${airlineName}</span>
                                  <span class="flight-code">${flightNumber}</span>
                                  ${renderCabinControl()}
                                </div>
                              </div>
                            `
        }
                    </div>
                    <div id="date-display-${index}" class="summary-date" style="font-size: 0.8rem; font-weight: 600; color: #2563eb; margin-top: 0.25rem;">${isMissingDate ? '' : flight.departure_date}</div>
                </div>
                
                <div class="flight-route-visual">
                    <div class="time-group">
                        <div class="time-big">${depTime}</div>
                        <div class="city-code">${formatCity(depCity, depAirport)}</div>
                    </div>
                    
                    <div class="duration-line-container">
                        <div class="duration-text">${duration}</div>
                        <div class="route-line"></div>
                        <div class="stops-text ${isDirect ? 'direct' : ''}">${displayStops}</div>
                    </div>
                    
                    <div class="time-group">
                        <div class="time-big">${arrTime}${daysOffset > 0 ? `<sup style="color: #f59e0b; font-size: 0.7rem; font-weight: 600; margin-left: 2px;">+${daysOffset}</sup>` : ''}</div>
                        <div class="city-code">${formatCity(arrCity, arrAirport)}</div>
                    </div>
                </div>
            </div>
            <div class="expand-icon" id="arrow-${uniqueId}"></div>
        </div>
      `;
    }

    function generateFareSpecificDetailsHTML(details) {
      const { baggage_cabin, baggage_checkin, baggage_pcs, meal, seat, cancellation_charges, penalty_charges } = details;

      const hasBaggage = baggage_cabin || baggage_checkin || baggage_pcs;
      const hasExtras = meal || seat;
      const hasCharges = cancellation_charges || penalty_charges;

      if (!hasBaggage && !hasExtras && !hasCharges) return '';

      let html = '<div style="display: flex; flex-direction: column; gap: 0.85rem;">';

      // Baggage Grid
      if (hasBaggage) {
        html += `
          <div>
            <div style="font-size: 0.65rem; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; margin-bottom: 4px; letter-spacing: 0.05em;">Baggage</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.5rem; font-size: 0.85rem;">
                ${baggage_cabin ? `<div><small style="color:var(--text-secondary); display:block; font-size: 0.6rem;">Cabin</small><span>${baggage_cabin}</span></div>` : ''}
                ${baggage_checkin ? `<div><small style="color:var(--text-secondary); display:block; font-size: 0.6rem;">Check-in</small><span>${baggage_checkin}</span></div>` : ''}
                ${baggage_pcs ? `<div><small style="color:var(--text-secondary); display:block; font-size: 0.6rem;">Pieces</small><span>${baggage_pcs}</span></div>` : ''}
            </div>
          </div>
        `;
      }

      // Extras Grid
      if (hasExtras) {
        html += `
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
             ${meal ? `<div><small style="color:var(--text-secondary); display:block; font-size: 0.6rem;">Meal</small><span style="font-size: 0.85rem;">${meal}</span></div>` : ''}
             ${seat ? `<div><small style="color:var(--text-secondary); display:block; font-size: 0.6rem;">Seat</small><span style="font-size: 0.85rem;">${seat}</span></div>` : ''}
          </div>
        `;
      }

      // Charges Grid
      if (hasCharges) {
        const renderCharge = (val) => {
          if (!val) return '';
          const showGST = /\d/.test(val);
          return `${val}${showGST ? ' <small style="font-weight:400; color:var(--text-secondary);">+GST</small>' : ''}`;
        };

        html += `
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
             ${details.cancellation_charges ? `<div><small style="color:var(--text-secondary); display:block; font-size: 0.6rem;">Cancellation</small><span style="font-weight:600; font-size:0.85rem; color:var(--danger);">${renderCharge(details.cancellation_charges)}</span></div>` : ''}
             ${details.penalty_charges ? `<div><small style="color:var(--text-secondary); display:block; font-size: 0.6rem;">Change Penalty</small><span style="font-weight:600; font-size:0.85rem; color:var(--warning);">${renderCharge(details.penalty_charges)}</span></div>` : ''}
          </div>
        `;
      }

      html += '</div>';
      return html;
    }

    function generateFlightTimelineHTML(flight, index, uniqueId) {
      const safe = (val, fallback = '') => {
        if (val === undefined || val === null || val === 'N/A' || val === 'Not Specified' || val === 'undefined' || val === 'null') {
          return fallback;
        }
        return val;
      };

      const depTime = safe(flight.departure_time, '--:--');
      const arrTime = safe(flight.arrival_time, '--:--');
      const depCity = safe(flight.departure_city, '');
      const arrCity = safe(flight.arrival_city, '');
      const depAirport = safe(flight.departure_airport, '');
      const arrAirport = safe(flight.arrival_airport, '');
      const airlineName = safe(flight.airline, 'Airline');
      const flightNumber = safe(flight.flight_number, '');
      const duration = safe(flight.duration, '--');

      const timelinePlaneIcon = '/icons/timeline%20plane.png';
      const expandedPlaneIcon = '/icons/expanded%20plane.png';
      const watchIcon = '/icons/watch.png';
      const layoverIcon = '/static/travel.png';

      const hasSegments = flight.segments && flight.segments.length > 0;
      const displayStops = safe(flight.stops, 'Direct');
      const isDirect = displayStops.toLowerCase().includes('non-stop') || displayStops.toLowerCase().includes('direct') || (flight.segments && flight.segments.length <= 1);

      const formatCity = (city, airport) => {
        if (!city) return airport || '';
        if (airport && city.includes(airport)) return city;
        if (airport && city.trim() === airport.trim()) return city;
        return `${city} <span class="airport-code-small">(${airport || ''})</span>`;
      };

      const calculateTimeDiff = (startTime, endTime) => {
        if (!startTime || !endTime) return null;
        try {
          const parseTime = (t) => {
            const parts = t.match(/(\d+):(\d+)\s*(AM|PM)?/i);
            if (!parts) return null;
            let h = parseInt(parts[1], 10);
            const m = parseInt(parts[2], 10);
            const p = parts[3] ? parts[3].toUpperCase() : null;
            if (p === 'PM' && h < 12) h += 12;
            if (p === 'AM' && h === 12) h = 0;
            return h * 60 + m;
          };
          const startMins = parseTime(startTime);
          const endMins = parseTime(endTime);
          if (startMins === null || endMins === null) return null;
          let diff = endMins - startMins;
          if (diff < 0) diff += 24 * 60;
          const hours = Math.floor(diff / 60);
          const minutes = diff % 60;
          let text = '';
          if (hours > 0) text += `${hours}h `;
          if (minutes > 0) text += `${minutes}m`;
          return { text: text.trim(), minutes: diff };
        } catch (e) { return null; }
      };

      const getLayoverLabel = (minutes) => {
        if (minutes < 60) return { label: 'Short Layover', alertClass: 'short' };
        if (minutes > 300) return { label: 'Long Wait', alertClass: 'long' };
        return { label: 'Layover', alertClass: '' };
      };

      const AIRPORT_TIMEZONES = {
        'CCU': 5.5, 'DEL': 5.5, 'BOM': 5.5, 'BLR': 5.5, 'MAA': 5.5, 'HYD': 5.5, 'AMD': 5.5, 'PNQ': 5.5, 'GOI': 5.5, 'COK': 5.5, 'GAU': 5.5, 'PAT': 5.5,
        'SIN': 8, 'BKK': 7, 'HKG': 8, 'KUL': 8, 'NRT': 9, 'HND': 9, 'ICN': 9, 'PEK': 8, 'PVG': 8, 'CMB': 5.5, 'DAC': 6, 'KTM': 5.75,
        'DXB': 4, 'DOH': 3, 'AUH': 4, 'BAH': 3, 'KWI': 3, 'MCT': 4,
        'LHR': 0, 'CDG': 1, 'FRA': 1, 'AMS': 1, 'FCO': 1, 'IST': 3,
        'JFK': -5, 'LAX': -8, 'SFO': -8, 'ORD': -6, 'YYZ': -5,
        'SYD': 10, 'MEL': 10, 'AKL': 12
      };

      const calculateSegmentDurationWithTimezone = (depT, arrT, depA, arrA) => {
        if (!depT || !arrT) return 'N/A';
        try {
          const parseTime = (t) => {
            const parts = t.match(/(\d+):(\d+)\s*(AM|PM)?/i);
            if (!parts) return null;
            let h = parseInt(parts[1], 10);
            const m = parseInt(parts[2], 10);
            const p = parts[3] ? parts[3].toUpperCase() : null;
            if (p === 'PM' && h < 12) h += 12;
            if (p === 'AM' && h === 12) h = 0;
            return h * 60 + m;
          };
          const dm = parseTime(depT);
          const am = parseTime(arrT);
          if (dm === null || am === null) return 'N/A';
          const dtz = AIRPORT_TIMEZONES[depA?.toUpperCase()] || 5.5;
          const atz = AIRPORT_TIMEZONES[arrA?.toUpperCase()] || 5.5;
          const td = Math.round((atz - dtz) * 60);
          let ad = am - dm;
          if (ad < 0) ad += 24 * 60;
          let actual = ad - td;
          if (actual < 0) actual += 24 * 60;
          if (actual > 24 * 60) actual -= 24 * 60;
          const hrs = Math.floor(actual / 60);
          const mins = actual % 60;
          return `${hrs}h ${mins}m`;
        } catch (e) { return 'N/A'; }
      };

      let html = `<div id="timeline-${uniqueId}" class="flight-timeline-container" data-flight-index="${index}" style="display: none;">`;
      html += '<div class="flight-timeline">';

      if (hasSegments && !isDirect) {
        flight.segments.forEach((seg, i) => {
          const nextSeg = flight.segments[i + 1];
          let segmentDuration = seg.duration;
          if (!segmentDuration || segmentDuration === 'Duration n/a' || segmentDuration === 'N/A') {
            segmentDuration = calculateSegmentDurationWithTimezone(seg.departure_time, seg.arrival_time, seg.departure_airport, seg.arrival_airport);
          }
          const sAir = safe(seg.airline, safe(flight.airline, 'Airline'));
          const sNum = safe(seg.flight_number, '');
          const sDT = safe(seg.departure_time, '--:--');
          const sAT = safe(seg.arrival_time, '--:--');
          const sDC = safe(seg.departure_city, safe(seg.departure_airport, 'Departure'));
          const sAC = safe(seg.arrival_city, safe(seg.arrival_airport, 'Arrival'));
          const sDA = safe(seg.departure_airport, '');
          const sAA = safe(seg.arrival_airport, '');
          const sDur = safe(segmentDuration, '--');

          html += `
                        <div class="timeline-segment">
                        <div class="t-dot departure"></div>
                        ${(i === flight.segments.length - 1) ? '<div class="t-dot arrival"></div>' : ''}
                        <div class="t-time-row">
                            <div class="t-time">${sDT}${seg.accumulated_dep_days > 0 ? `<sup style="color: #f59e0b; font-size: 0.65rem; font-weight: 600; margin-left: 2px;">+${seg.accumulated_dep_days}</sup>` : ''}</div>
                            <div class="t-city">${formatCity(sDC, sDA)}</div>
                        </div>
                        <div class="flight-info-block">
                            <div class="info-row">
                                <div class="info-icon"><img src="${expandedPlaneIcon}" alt="" loading="lazy" decoding="async" fetchpriority="low"></div>
                                 <span style="font-weight: 600; color: var(--text-primary);">${sAir} ${sNum}</span>
                            </div>
                            <div class="info-row" style="flex-wrap: wrap; gap: 0.5rem 1.25rem;">
                                <div class="info-icon"><img src="${watchIcon}" alt="" loading="lazy" decoding="async" fetchpriority="low"></div>
                                 <span>${sDur}</span>
                            </div>
                        </div>
                        <div class="t-time-row">
                            <div class="t-time" style="color: var(--text-secondary); font-size: 1rem;">${sAT}${(seg.accumulated_arr_days || seg.days_offset) > 0 ? `<sup style="color: #f59e0b; font-size: 0.65rem; font-weight: 600; margin-left: 2px;">+${seg.accumulated_arr_days || seg.days_offset}</sup>` : ''}</div>
                            <div class="t-city" style="font-weight: 500; color: var(--text-secondary); font-size: 0.95rem;">${formatCity(sAC, sAA)}</div>
                        </div>
                    </div>
                 `;

          if (nextSeg) {
            let dText = safe(nextSeg.layover_duration, '');
            let lText = 'Layover';
            if (!dText) {
              const lDiff = calculateTimeDiff(seg.arrival_time, nextSeg.departure_time);
              if (lDiff) { dText = lDiff.text; lText = getLayoverLabel(lDiff.minutes).label; }
            } else {
              const dM = dText.match(/(\d+)h\s*(\d+)?m?/);
              if (dM) lText = getLayoverLabel(parseInt(dM[1]) * 60 + (parseInt(dM[2]) || 0)).label;
            }
            const lDC = safe(nextSeg.departure_city, safe(nextSeg.departure_airport, ''));
            html += `
                        <div class="layover-container">
                            <div class="layover-icon-box" title="Layover">
                               <img src="${layoverIcon}" alt="Airport" loading="lazy" decoding="async" fetchpriority="low">
                            </div>
                            <div class="layover-pill"><span class="layover-pill-icon"><img src="${watchIcon}" alt="" loading="lazy" decoding="async" fetchpriority="low"></span><span>${lText} in ${lDC} &bull; ${dText}</span></div>
                        </div>
                    `;
          }
        });
      } else {
        html += `
                <div class="timeline-segment">
                    <div class="t-dot departure"></div>
                    <div class="t-time-row">
                        <div class="t-time">${depTime}</div>
                        <div class="t-city">${formatCity(depCity, depAirport)}</div>
                    </div>
                    <div class="flight-info-block">
                        <div class="info-row">
                             <div class="info-icon"><img class="timeline-plane-icon" src="${timelinePlaneIcon}" alt=""></div>
                             <span style="font-weight: 600; color: var(--text-primary);">${airlineName} ${flightNumber}</span>
                        </div>
                        ${duration && duration !== '--' ? `<div class="info-row"><div class="info-icon"><img src="${watchIcon}" alt="" loading="lazy" decoding="async" fetchpriority="low"></div><span>${duration}</span></div>` : ''}
                    </div>

                    <div class="t-dot arrival"></div>
                    <div class="t-time-row">
                        <div class="t-time">${arrTime}</div>
                        <div class="t-city">${formatCity(arrCity, arrAirport)}</div>
                    </div>
                </div>
            `;
      }

      html += '</div></div>';
      return html;
    }
    function createFlightCard(flight, index) {
      const card = document.createElement('div');
      card.className = 'flight-card';
      card.setAttribute('data-flight-index', index);
      const uniqueId = `flight-${index}-${Math.random().toString(36).substr(2, 9)}`;

      const isMissingDate = !flight.departure_date || flight.departure_date === 'N/A';
      
      const optionLabelHTML = `<div class="card-top-strip" style="justify-content: flex-end; padding-left: 10px;">
          <div class="option-label">Option ${index + 1}</div>
      </div>`;

      let dateHeaderHTML = '';
      if (isMissingDate) {
        dateHeaderHTML = `<div class="date-warning-strip" id="date-warning-${index}"><span>⚠️ Date Required</span><button class="date-btn" onclick="promptDateInput(${index})">Select Date</button></div>`;
      }

      const summaryHTML = generateFlightSummaryHTML(flight, index, uniqueId);
      const timelineHTML = generateFlightTimelineHTML(flight, index, uniqueId);

      const faresHTML = generateFaresFooterHTML(flight);

      // Inline editor placeholder
      let inlineEditorPlaceholder = '';
      if (flight.is_editable) {
        inlineEditorPlaceholder = `<div id="inline-editor-${index}" class="inline-fare-editor" style="display: none;"></div>`;
      }

      let passengerFooterHtml = '';
      if (savePassengers && savePassengers.length > 0) {
        passengerFooterHtml = `
          <div class="itinerary-passengers-footer">
            <div class="itinerary-passengers-label">PASSENGERS</div>
            <div class="itinerary-passengers-names">
              ${savePassengers.map(p => `<span class="passenger-chip">${p.title ? p.title + ' ' : ''}${p.first_name} ${p.last_name || ''}</span>`).join('')}
            </div>
            <img class="card-watermark-img" src="/static/logo.png" alt="" loading="eager" decoding="async" fetchpriority="high" style="bottom: 8px; right: 8px;">
          </div>
        `;
        card.innerHTML = optionLabelHTML + dateHeaderHTML + summaryHTML + timelineHTML + faresHTML + inlineEditorPlaceholder + passengerFooterHtml;
      } else {
        card.innerHTML = `<img class="card-watermark-img" src="/static/logo.png" alt="" loading="eager" decoding="async" fetchpriority="high">` + optionLabelHTML + dateHeaderHTML + summaryHTML + timelineHTML + faresHTML + inlineEditorPlaceholder;
      }
      return card;
    }

    function generateFaresFooterHTML(flight, variant = '') {
      let extraClass = '';
      if (variant === 'outbound') extraClass = ' fare-footer-outbound';
      else if (variant === 'return') extraClass = ' fare-footer-return';
      const rupeeIcon = '<span class="currency-icon"><img src="/icons/rupee.png" alt="Rs" loading="lazy" decoding="async" fetchpriority="low"></span>';
      const numFares = Object.keys(flight.fares || {}).length;
      const orderedFareEntries = getOrderedFareEntries(flight);

      let faresHTML = `<div class="card-footer-fares${extraClass}">`;
      orderedFareEntries.forEach(([type, base]) => {
        const perFareMU = flight.fare_mu && flight.fare_mu[type] !== undefined ? flight.fare_mu[type] : (flight.markup || 0);
        const finalFare = base + perFareMU;
        const perFareSVC = flight.fare_svc && flight.fare_svc[type] !== undefined ? flight.fare_svc[type] : (flight.service_charge || 0);
        const perFareGST = perFareSVC > 0 ? Math.round(perFareSVC * 0.18) : 0;
        let extraText = '';
        if (perFareSVC > 0) {
          extraText = ` <span style="font-size: 0.75rem; color: var(--text-secondary); font-weight: normal;">(+ ${rupeeIcon}${perFareSVC} SVC + ${rupeeIcon}${perFareGST} GST)</span>`;
        }

        const fareUniqueId = `fare-${type}-${Math.random().toString(36).substr(2, 5)}`;

        // Decide which details to show in the collapsible
        let detailsToRender = (flight.fare_extra_details && flight.fare_extra_details[type]) || {};

        // If single fare, ensure we have the main baggage/extra info if not already there
        if (numFares === 1) {
          detailsToRender = { ...detailsToRender };
          if (!detailsToRender.baggage_cabin && flight.baggage_cabin) detailsToRender.baggage_cabin = flight.baggage_cabin;
          if (!detailsToRender.baggage_checkin && flight.baggage_checkin) detailsToRender.baggage_checkin = flight.baggage_checkin;
          if (!detailsToRender.baggage_pcs && flight.baggage_pcs) detailsToRender.baggage_pcs = flight.baggage_pcs;
          if (!detailsToRender.meal && flight.meal) detailsToRender.meal = flight.meal;
          if (!detailsToRender.seat && flight.seat) detailsToRender.seat = flight.seat;
          if (!detailsToRender.cancellation_charges && flight.cancellation_charges) detailsToRender.cancellation_charges = flight.cancellation_charges;
          if (!detailsToRender.penalty_charges && flight.penalty_charges) detailsToRender.penalty_charges = flight.penalty_charges;
        }

        const fareDetailsHTML = generateFareSpecificDetailsHTML(detailsToRender);
        const hasClickableDetails = fareDetailsHTML.trim().length > 0;

        faresHTML += `
              <div class="footer-fare-item" ${hasClickableDetails ? `onclick="toggleFareDetails('${fareUniqueId}')" style="cursor:pointer;"` : ''}>
                <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                    <span class="footer-fare-label">${getFareDisplayLabel(flight, type)}</span>
                    ${hasClickableDetails ? `<span id="fare-toggle-icon-${fareUniqueId}" style="font-size:0.7rem; color:var(--text-secondary); transition: transform 0.3s ease;">▼</span>` : ''}
                </div>
                <span class="footer-fare-price">${rupeeIcon}${finalFare.toLocaleString('en-IN')}${extraText} <span style="font-size: 0.75rem; color: var(--text-secondary); font-weight: normal; margin-left: 2px;">per pax</span></span>
                
                ${hasClickableDetails ? `
                <div id="${fareUniqueId}" class="fare-details-collapsible" style="display:none; width:100%; margin-top:0.5rem; border-top:1px solid var(--border); padding-top:0.5rem; text-align: left;">
                    ${fareDetailsHTML}
                </div>
                ` : ''}
              </div>
            `;
      });
      faresHTML += '</div>';
      return faresHTML;
    }

    function getOrderedFareEntries(flight) {
      const fares = flight && flight.fares ? flight.fares : {};
      const fareMU = (flight && flight.fare_mu) ? flight.fare_mu : {};
      const globalMU = (flight && flight.markup) ? flight.markup : 0;

      const entries = Object.entries(fares).map(([type, base]) => {
        const mu = (fareMU[type] !== undefined) ? fareMU[type] : globalMU;
        return { type, base, total: base + mu };
      });

      // Sort by total price ascending (lowest to highest)
      entries.sort((a, b) => a.total - b.total);

      return entries.map(e => [e.type, e.base]);
    }

    function getFareDisplayLabel(flight, type) {
      const customLabel = flight && flight.fare_labels ? flight.fare_labels[type] : '';
      if (customLabel && customLabel.trim()) return customLabel.trim();
      return String(type || '')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase())
        .trim();
    }

    function createRoundTripFlightCard(outbound, returnFlight, index, unitId) {
      const card = document.createElement('div');
      card.className = 'flight-card combined-flight-card';
      card.setAttribute('data-flight-index', index);

      const outUniqueId = `flight-${index}-out-${Math.random().toString(36).substr(2, 4)}`;
      const retUniqueId = `flight-${index}-ret-${Math.random().toString(36).substr(2, 4)}`;

      const optionLabelHTML = ``;

      // Outbound Section
      const outSummary = generateFlightSummaryHTML(outbound, index, outUniqueId);
      const outTimeline = generateFlightTimelineHTML(outbound, index, outUniqueId);

      // Return Section
      const retSummary = generateFlightSummaryHTML(returnFlight, index + 1, retUniqueId);
      const retTimeline = generateFlightTimelineHTML(returnFlight, index + 1, retUniqueId);

      // Date warnings
      let dateHeaderHTML = '';
      if ((!outbound.departure_date || outbound.departure_date === 'N/A')) {
        dateHeaderHTML += `<div class="date-warning-strip" id="date-warning-${index}"><span>⚠️ Outbound Date Required</span><button class="date-btn" onclick="promptDateInput(${index})">Select</button></div>`;
      }
      if ((!returnFlight.departure_date || returnFlight.departure_date === 'N/A')) {
        dateHeaderHTML += `<div class="date-warning-strip" id="date-warning-${index + 1}"><span>⚠️ Return Date Required</span><button class="date-btn" onclick="promptDateInput(${index + 1})">Select</button></div>`;
      }

      // Dividers and Labels
      const outLabel = '<div class="combined-label">Outbound</div>';
      const retLabel = '<div class="combined-label" style="background:var(--secondary);">Return</div>';
      const divider = '<div class="flight-divider"></div>';

      // Check if fares are split
      // We perform a deep comparison of the fares objects to determine if they are identical
      const areFaresInitiallySame = (f1, f2) => {
        const k1 = Object.keys(f1).sort();
        const k2 = Object.keys(f2).sort();
        if (k1.length !== k2.length) return false;
        if (!k1.every((key, i) => key === k2[i])) return false;
        return k1.every(key => f1[key] === f2[key]);
      };

      // Only show split layout if:
      // 1. User original choice was split (is_split)
      // 2. OR the fares are actually different (fallback)
      const areFaresDifferent = (outbound.is_split === true) || !areFaresInitiallySame(outbound.fares, returnFlight.fares);

      let html = optionLabelHTML + dateHeaderHTML;

      if (areFaresDifferent) {
        // Split Layout
        const outFares = generateFaresFooterHTML(outbound, 'outbound');
        const retFares = generateFaresFooterHTML(returnFlight, 'return');

        html += outLabel + outSummary + outTimeline + outFares + divider + retLabel + retSummary + retTimeline + retFares;
      } else {
        // Combined Layout
        const faresHTML = generateFaresFooterHTML(outbound); // Use outbound as shared source
        html += outLabel + outSummary + outTimeline + divider + retLabel + retSummary + retTimeline + faresHTML;
      }

      // Editor placeholders
      if (outbound.is_editable) html += `<div id="inline-editor-${index}" class="inline-fare-editor" style="display: none;"></div>`;
      if (returnFlight.is_editable) html += `<div id="inline-editor-${index + 1}" class="inline-fare-editor" style="display: none;"></div>`;

      let passengerFooterHtml = '';
      if (savePassengers && savePassengers.length > 0) {
        passengerFooterHtml = `
          <div class="itinerary-passengers-footer">
            <div class="itinerary-passengers-label">PASSENGERS</div>
            <div class="itinerary-passengers-names">
              ${savePassengers.map(p => `<span class="passenger-chip">${p.title ? p.title + ' ' : ''}${p.first_name} ${p.last_name || ''}</span>`).join('')}
            </div>
            <img class="card-watermark-img" src="/static/logo.png" alt="" loading="eager" decoding="async" fetchpriority="high" style="bottom: 8px; right: 8px;">
          </div>
        `;
        card.innerHTML = html + passengerFooterHtml;
      } else {
        card.innerHTML = `<img class="card-watermark-img" src="/static/logo.png" alt="" loading="eager" decoding="async" fetchpriority="high">` + html;
      }
      return card;
    }

    function createRoundTripCardWithEditButton(outbound, returnFlight, index, unitId) {
      const wrapper = document.createElement('div');
      wrapper.className = 'card-wrapper';
      wrapper.style.marginBottom = '1.5rem';

      if (outbound.is_editable || returnFlight.is_editable) {
        const editBar = document.createElement('div');
        editBar.className = 'card-edit-bar';
        editBar.id = `card-edit-bar-${index}`;
        editBar.style.display = isGlobalEditMode ? 'flex' : 'none';
        editBar.innerHTML = `
                <div style="display: flex; gap: 0.5rem; align-items: center;">
                    <button class="card-edit-btn" onclick="toggleInlineFareEditor(${index})" id="edit-btn-${index}">
                        ✏️ Edit Fares
                    </button>
                    <button class="card-delete-btn" onclick="deleteFlightOption(${index})" title="Delete This Option">
                        🗑️
                    </button>
                </div>
            `;
        wrapper.appendChild(editBar);
      }

      const card = createRoundTripFlightCard(outbound, returnFlight, index, unitId);
      wrapper.appendChild(card);
      return wrapper;
    }

    function createMultiCityFlightCard(flightList, startIndex, unitId) {
      const card = document.createElement('div');
      card.className = 'flight-card combined-flight-card';
      card.setAttribute('data-flight-index', startIndex);

      const optionLabelHTML = ``;
      let contentHTML = optionLabelHTML;

      flightList.forEach((flight, i) => {
        const flightIndex = startIndex + i;
        const uniqueId = `flight-${flightIndex}-mc-${Math.random().toString(36).substr(2, 4)}`;

        const isMissingDate = !flight.departure_date || flight.departure_date === 'N/A';
        if (isMissingDate) {
          contentHTML += `<div class="date-warning-strip" id="date-warning-${flightIndex}"><span>⚠️ Date Required for Flight ${i + 1}</span><button class="date-btn" onclick="promptDateInput(${flightIndex})">Select Date</button></div>`;
        }

        const label = `<div class="combined-label">Flight ${i + 1}</div>`;
        const summary = generateFlightSummaryHTML(flight, flightIndex, uniqueId);
        const timeline = generateFlightTimelineHTML(flight, flightIndex, uniqueId);
        const divider = i < flightList.length - 1 ? '<div class="flight-divider"></div>' : '';

        contentHTML += label + summary + timeline + divider;
      });

      // Use fares from the first flight (shared for the option)
      const faresHTML = generateFaresFooterHTML(flightList[0]);

      // Editor placeholders
      let editorHTML = '';
      flightList.forEach((f, i) => {
        if (f.is_editable) editorHTML += `<div id="inline-editor-${startIndex + i}" class="inline-fare-editor" style="display: none;"></div>`;
      });

      let passengerFooterHtml = '';
      if (savePassengers && savePassengers.length > 0) {
        passengerFooterHtml = `
          <div class="itinerary-passengers-footer">
            <div class="itinerary-passengers-label">PASSENGERS</div>
            <div class="itinerary-passengers-names">
              ${savePassengers.map(p => `<span class="passenger-chip">${p.title ? p.title + ' ' : ''}${p.first_name} ${p.last_name || ''}</span>`).join('')}
            </div>
            <img class="card-watermark-img" src="/static/logo.png" alt="" loading="eager" decoding="async" fetchpriority="high" style="bottom: 8px; right: 8px;">
          </div>
        `;
        card.innerHTML = contentHTML + faresHTML + editorHTML + passengerFooterHtml;
      } else {
        card.innerHTML = `<img class="card-watermark-img" src="/static/logo.png" alt="" loading="eager" decoding="async" fetchpriority="high">` + contentHTML + faresHTML + editorHTML;
      }
      return card;
    }

    function createMultiCityCardWithEditButton(flightList, startIndex, unitId) {
      const wrapper = document.createElement('div');
      wrapper.className = 'card-wrapper';
      wrapper.style.marginBottom = '1.5rem';

      const anyEditable = flightList.some(f => f.is_editable);

      if (anyEditable) {
        const editBar = document.createElement('div');
        editBar.className = 'card-edit-bar';
        editBar.id = `card-edit-bar-${startIndex}`;
        editBar.style.display = isGlobalEditMode ? 'flex' : 'none';
        editBar.innerHTML = `
                <div style="display: flex; gap: 0.5rem; align-items: center;">
                    <button class="card-edit-btn" onclick="toggleInlineFareEditor(${startIndex})" id="edit-btn-${startIndex}">
                        ✏️ Edit Fares
                    </button>
                    <button class="card-delete-btn" onclick="deleteFlightOption(${startIndex})" title="Delete This Option">
                        🗑️
                    </button>
                </div>
            `;
        wrapper.appendChild(editBar);
      }

      const card = createMultiCityFlightCard(flightList, startIndex, unitId);
      wrapper.appendChild(card);
      return wrapper;
    }

    // Creates a wrapper with edit button above the card
    function createCardWithEditButton(flight, index) {
      const wrapper = document.createElement('div');
      wrapper.className = 'card-wrapper';
      wrapper.style.marginBottom = '0.75rem';

      // Add edit button above card if editable (hidden by default, shown in global edit mode)
      if (flight.is_editable) {
        const editBar = document.createElement('div');
        editBar.className = 'card-edit-bar';
        editBar.id = `card-edit-bar-${index}`;
        // Initially hidden - will be shown when global edit mode is activated
        editBar.style.display = isGlobalEditMode ? 'flex' : 'none';
        editBar.innerHTML = `
          <div style="display: flex; gap: 0.5rem; align-items: center;">
            <button class="card-edit-btn" onclick="toggleInlineFareEditor(${index})" id="edit-btn-${index}">
              ✏️ Edit
            </button>
            <button class="card-delete-btn" onclick="deleteFlightOption(${index})" title="Delete This Option">
              🗑️
            </button>
          </div>
        `;
        wrapper.appendChild(editBar);
      }

      // Add the flight card
      const card = createFlightCard(flight, index);
      wrapper.appendChild(card);

      return wrapper;
    }

    // Toggle global edit mode for all cards
    function toggleGlobalEditMode() {
      isGlobalEditMode = !isGlobalEditMode;

      const globalEditBtn = document.getElementById('globalEditBtn');

      // Find all card edit bars and toggle their visibility
      currentFlights.forEach((flight, index) => {
        if (flight.is_editable) {
          const editBar = document.getElementById(`card-edit-bar-${index}`);
          if (editBar) {
            editBar.style.display = isGlobalEditMode ? 'flex' : 'none';
          }
          // If turning off edit mode, hide any open editors and reset their buttons
          if (!isGlobalEditMode) {
            const editor = document.getElementById(`inline-editor-${index}`);
            if (editor) {
              editor.style.display = 'none';
              getRelatedFlightIndices(index).forEach(idx => {
                activeCabinEditorFlights.delete(idx);
                clearPendingCabinSelections(idx);
              });
              // Reset edit button state
              const editBtn = document.getElementById(`edit-btn-${index}`);
              if (editBtn) {
                editBtn.innerHTML = '✏️ Edit';
                editBtn.classList.remove('active');
              }
            }
          }
        }
      });

      if (isGlobalEditMode) {
        globalEditBtn.innerHTML = '✕ Cancel Edit';
        globalEditBtn.classList.add('active');
      } else {
        globalEditBtn.innerHTML = '✏️ Edit Fares';
        globalEditBtn.classList.remove('active');
      }

      // RE-RENDER to update card contents (switching between select and pills)
      renderResults(currentFlights);
    }

    function getRelatedFlightIndices(flightIndex) {
      // unitFlights stores 1-based IDs from the input boxes.
      // rendered results use 0-based indices from the currentFlights array.
      // We need to map the flightIndex to its unit by calculating the cumulative counts.
      let currentBaseIndex = 0;
      const units = Object.entries(unitFlights || {});

      for (const [unitId, flightIds] of units) {
        const count = Array.isArray(flightIds) ? flightIds.length : 0;
        if (flightIndex >= currentBaseIndex && flightIndex < currentBaseIndex + count) {
          const related = [];
          for (let i = 0; i < count; i++) {
            related.push(currentBaseIndex + i);
          }
          return related;
        }
        currentBaseIndex += count;
      }

      return [flightIndex];
    }

    function clearPendingCabinSelections(flightIndex) {
      Object.keys(pendingCabinSelections).forEach(key => {
        if (key.startsWith(`${flightIndex}:`)) {
          delete pendingCabinSelections[key];
        }
      });
    }

    function initializePendingCabinSelections(flightIndex) {
      const flight = currentFlights[flightIndex];
      if (!flight) return;

      pendingCabinSelections[`${flightIndex}:flight`] = flight.show_cabin_class
        ? ((flight.cabin_class || flight.class_of_travel || '').toString().trim().toLowerCase())
        : '';

      (flight.segments || []).forEach((segment, segIdx) => {
        pendingCabinSelections[`${flightIndex}:${segIdx}`] = segment && segment.show_booking_class
          ? ((segment.cabin_class || segment.class_of_travel || '').toString().trim().toLowerCase())
          : '';
      });
    }

    function updateFlightCabinClass(flightIndex, segmentIndex, cabinValue) {
      const key = `${flightIndex}:${segmentIndex !== null && segmentIndex !== undefined ? segmentIndex : 'flight'}`;
      pendingCabinSelections[key] = (cabinValue || '').toString().trim().toLowerCase();
    }

    // createSegmentsHTML is no longer used separately, integrated into createFlightCard
    function createSegmentsHTML(flight) { return ''; }

    // ============== Inline Fare Editor Functions ==============

    function toggleInlineFareEditor(flightIndex) {
      let editor = document.getElementById(`inline-editor-${flightIndex}`);
      let editBtn = document.getElementById(`edit-btn-${flightIndex}`);
      const relatedFlightIndices = getRelatedFlightIndices(flightIndex);

      if (!editor) return;

      if (editor.style.display === 'none') {
        // Show editor
        editor.style.display = 'block';
        editBtn.innerHTML = '✕ Cancel';
        editBtn.classList.add('active');
        relatedFlightIndices.forEach(idx => activeCabinEditorFlights.add(idx));
        relatedFlightIndices.forEach(idx => initializePendingCabinSelections(idx));
        renderResults(currentFlights);
        editor = document.getElementById(`inline-editor-${flightIndex}`);
        editBtn = document.getElementById(`edit-btn-${flightIndex}`);
        if (editor) editor.style.display = 'block';
        if (editBtn) {
          editBtn.innerHTML = '✕ Cancel';
          editBtn.classList.add('active');
        }

        // Populate editor with current fare data
        populateInlineFareEditor(flightIndex);
      } else {
        // Hide editor
        editor.style.display = 'none';
        editBtn.innerHTML = '✏️ Edit';
        editBtn.classList.remove('active');
        relatedFlightIndices.forEach(idx => {
          activeCabinEditorFlights.delete(idx);
          clearPendingCabinSelections(idx);
        });
        renderResults(currentFlights);
      }
    }

    function populateInlineFareEditor(flightIndex) {
      const flight = currentFlights[flightIndex];
      const editor = document.getElementById(`inline-editor-${flightIndex}`);

      if (!editor || !flight) return;

      const isRoundTrip = currentTripType === 'round_trip' && currentFlights[flightIndex + 1];
      let isSplit = false;
      let returnFlight = null;

      if (isRoundTrip) {
        returnFlight = currentFlights[flightIndex + 1];
        // Deep compare fares to see if split
        const areFaresSame = (f1, f2) => {
          const k1 = Object.keys(f1).sort();
          const k2 = Object.keys(f2).sort();
          if (k1.length !== k2.length) return false;
          if (!k1.every((key, i) => key === k2[i])) return false;
          return k1.every(key => f1[key] === f2[key]);
        };
        // Use flag if set, otherwise check content
        isSplit = (flight.is_split === true) || !areFaresSame(flight.fares, returnFlight.fares);
      }

      // Helper to generate a section
      const generateSectionHTML = (fData, fIdx, suffix, title, displayStyle = 'block', hideFares = false) => {
        let html = `<div id="inline-section-${fIdx}${suffix}" style="display: ${displayStyle}; margin-bottom: 1.5rem;">`;
        if (title) html += `<h5 style="margin: 0 0 0.5rem 0; color: var(--text-secondary); border-bottom: 1px dashed var(--border); padding-bottom: 0.25rem;">${title}</h5>`;

        // Add Date Editor
        const dateVal = (!fData.departure_date || fData.departure_date === 'N/A') ? '' : fData.departure_date;
        html += `
            <div style="margin-bottom: 1rem;">
                <label style="font-size: 0.75rem; color: var(--text-secondary); font-weight: 600; display: block; margin-bottom: 4px;">Departure Date</label>
                <input type="text" class="form-input inline-date-${fIdx}${suffix}" placeholder="e.g. 12 Feb 26" value="${dateVal}" style="width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: 6px;">
            </div>
        `;

        let faresHTML = '';
        // Sort fares by price for consistency
        const sortedFares = Object.entries(fData.fares).sort((a, b) => {
          const muA = fData.fare_mu && fData.fare_mu[a[0]] !== undefined ? fData.fare_mu[a[0]] : currentMarkup;
          const muB = fData.fare_mu && fData.fare_mu[b[0]] !== undefined ? fData.fare_mu[b[0]] : currentMarkup;
          return (a[1] + muA) - (b[1] + muB);
        });

        sortedFares.forEach(([fareType, baseFare]) => {
          let mu = fData.fare_mu && fData.fare_mu[fareType] !== undefined ? fData.fare_mu[fareType] : '';
          let svc = fData.fare_svc && fData.fare_svc[fareType] !== undefined ? fData.fare_svc[fareType] : '';
          let extras = fData.fare_extra_details && fData.fare_extra_details[fareType] ? fData.fare_extra_details[fareType] : {};

          // Fallback to global if empty
          if ((mu === '' || mu === undefined) && currentMarkup > 0) mu = currentMarkup;
          if ((svc === '' || svc === undefined) && currentServiceCharge > 0) svc = currentServiceCharge;

          const cabinLabels = {
            'economy': 'Economy',
            'premium_economy': 'Premium Economy',
            'business': 'Business Class',
            'first': 'First Class'
          };
          let label = cabinLabels[fareType] || (fareType.charAt(0).toUpperCase() + fareType.slice(1).replace('_', ' ') + ' Fare');

          faresHTML += createInlineFareCard(fIdx, fareType, label, baseFare, mu, svc, extras, true, suffix);
        });

        const faresStyle = hideFares ? 'display: none;' : '';

        html += `<div class="fare-types" id="inline-fare-list-${fIdx}${suffix}" style="${faresStyle}">${faresHTML}</div>`;

        html += `
            <div class="add-fare-controls" id="inline-fare-controls-${fIdx}${suffix}" style="margin-top: 0.5rem; padding-top: 0.5rem; ${faresStyle}">
               <select class="form-select" style="width: 100%; max-width: 200px; padding: 0.4rem; font-size: 0.85rem; border-radius: 6px; border: 1.5px solid var(--border);" onchange="handleInlineAddFareType(this, ${fIdx}, '${suffix}')">
                 <option value="">+ Add Fare Type...</option>
                 <optgroup label="Fare Types">
                     <option value="corporate">Corporate Fare</option>
                     <option value="sme">SME Fare</option>
                     <option value="coupon">Coupon Fare</option>
                     <option value="flexi">Flexi Fare</option>
                 </optgroup>
                 <optgroup label="Cabin Classes">
                     <option value="economy">Economy</option>
                     <option value="premium_economy">Premium Economy</option>
                     <option value="business">Business Class</option>
                     <option value="first">First Class</option>
                 </optgroup>
                 <option value="custom">Custom...</option>
               </select>
            </div>
          </div>`;
        return html;
      };

      let contentHTML = `
        <div class="inline-fare-editor-header">
          <h4>✏️ Edit Fares for Option ${Math.floor(flightIndex / 2) + 1}</h4> <!-- Approximation for unit ID -->
        </div>`;

      if (isRoundTrip) {
        contentHTML += `
            <div style="margin-bottom: 1rem; padding-bottom: 0.5rem; border-bottom: 1px solid var(--border);">
               <label style="display: flex; align-items: center; gap: 0.5rem; font-weight: 500; cursor: pointer; font-size: 0.9rem;">
                  <input type="checkbox" id="inline-split-toggle-${flightIndex}" onchange="toggleInlineSplit(${flightIndex})" ${isSplit ? 'checked' : ''}>
                  <span>Separate Fares for Outbound & Return</span>
               </label>
            </div>
          `;

        contentHTML += generateSectionHTML(flight, flightIndex, '_out', isSplit ? '✈️ Outbound Fares' : '📊 Combined Fares');
        contentHTML += generateSectionHTML(returnFlight, flightIndex, '_ret', '✈️ Return Fares', 'block', !isSplit); // Always show section for Date, hide fares if !isSplit
      } else {
        // Normal One-Way / Multi-City (Single List)
        contentHTML += generateSectionHTML(flight, flightIndex, '', '');
      }

      contentHTML += `
        <div class="inline-fare-editor-actions">
          <button class="btn-cancel" onclick="toggleInlineFareEditor(${flightIndex})">Cancel</button>
          <button class="btn-save" onclick="saveInlineFareChanges(${flightIndex})">💾 Save Changes</button>
        </div>
      `;

      editor.innerHTML = contentHTML;
    }

    function toggleInlineSplit(flightIndex) {
      const toggle = document.getElementById(`inline-split-toggle-${flightIndex}`);
      // Return section is now ALWAYS visible (for Date), but we toggle Fares visibility
      const retFareList = document.getElementById(`inline-fare-list-${flightIndex}_ret`);
      const retControls = document.getElementById(`inline-fare-controls-${flightIndex}_ret`);
      const outHeader = document.querySelector(`#inline-section-${flightIndex}_out h5`);

      if (toggle && toggle.checked) {
        // Show Return Fares
        if (retFareList) retFareList.style.display = 'block';
        if (retControls) retControls.style.display = 'block';
        if (outHeader) outHeader.textContent = '✈️ Outbound Fares';
      } else {
        // Hide Return Fares (Date stays)
        if (retFareList) retFareList.style.display = 'none';
        if (retControls) retControls.style.display = 'none';
        if (outHeader) outHeader.textContent = '📊 Combined Fares';
      }
    }

    function createInlineFareCard(flightIndex, key, label, baseFare, mu, svc, extras, isChecked, suffix = '') {
      const checkedAttr = isChecked ? 'checked' : '';
      const disabledAttr = isChecked ? '' : 'disabled';
      const cardClass = isChecked ? 'fare-card' : 'fare-card disabled';
      const uniqueId = `inline-fare-card-${key}-${flightIndex}${suffix}`;
      const detailsId = `inline-details-${uniqueId}`;

      // Extras values
      const val = extras || {};

      return `
        <div class="${cardClass}" data-fare-key="${key}" id="${uniqueId}">
          <div class="fare-card-header" style="display: flex; justify-content: space-between; align-items: center;">
            <div style="display: flex; align-items: center; gap: 0.5rem; width: 100%;">
              <input type="checkbox" id="chk-${uniqueId}" onchange="toggleInlineFareCard(this, '${key}', ${flightIndex}, '${suffix}')" ${checkedAttr}>
              <select class="fare-type-selector" onchange="changeInlineFareCardType(this, '${key}', ${flightIndex}, '${suffix}')">
                <option value="saver" ${key === 'saver' ? 'selected' : ''}>Saver Fare</option>
                <option value="corporate" ${key === 'corporate' ? 'selected' : ''}>Corporate Fare</option>
                <option value="sme" ${key === 'sme' ? 'selected' : ''}>SME Fare</option>
                <option value="coupon" ${key === 'coupon' ? 'selected' : ''}>Coupon Fare</option>
                <option value="flexi" ${key === 'flexi' ? 'selected' : ''}>Flexi Fare</option>
                <option value="economy" ${key === 'economy' ? 'selected' : ''}>Economy</option>
                <option value="premium_economy" ${key === 'premium_economy' ? 'selected' : ''}>Premium Economy</option>
                <option value="business" ${key === 'business' ? 'selected' : ''}>Business Class</option>
                <option value="first" ${key === 'first' ? 'selected' : ''}>First Class</option>
                ${!['saver','corporate','sme','coupon','flexi','economy','premium_economy','business','first'].includes(key) ? `<option value="${key}" selected>${label}</option>` : ''}
                <option value="custom">Custom...</option>
              </select>
            </div>
            <button class="fare-delete-icon-btn" style="background:none; border:none; color:var(--text-secondary); cursor:pointer; font-size:1rem;" onclick="removeFareFromInline('${uniqueId}')" title="Remove This Fare Type">
              ✕
            </button>
          </div>
          <div class="fare-card-fields">
            <div class="fare-field-row">
              <span class="fare-field-label">Fare</span>
              <input type="number" class="fare-field-input inline-fare-${uniqueId}" placeholder="₹ 0" min="0" value="${baseFare !== undefined && baseFare !== null ? baseFare : ''}" ${disabledAttr}>
            </div>
            <div class="fare-field-row">
              <span class="fare-field-label">MU</span>
              <input type="number" class="fare-field-input inline-mu-${uniqueId}" placeholder="Markup" min="0" value="${mu}" ${disabledAttr}>
            </div>
            <div class="fare-field-row">
              <span class="fare-field-label">SVC</span>
              <input type="number" class="fare-field-input inline-svc-${uniqueId}" placeholder="Service Chg" min="0" value="${svc}" ${disabledAttr}>
            </div>
          </div>
          
          <div class="fare-extras-toggle" style="margin-top: 10px; border-top: 1px solid var(--border); padding-top: 8px;">
            <button type="button" onclick="toggleInlineFareDetails('${detailsId}')" style="background: none; border: none; color: var(--primary); font-size: 0.75rem; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 4px; padding: 0;">
              <span>➕ Add Baggage & Extras</span>
              <span id="inline-toggle-icon-${detailsId}" style="transition: transform 0.3s ease;">▼</span>
            </button>
          </div>
          
          <div id="${detailsId}" style="display: none; margin-top: 10px; padding: 8px; background: rgba(0,0,0,0.02); border-radius: 6px;">
             <!-- Baggage -->
             <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-bottom: 8px;">
                <div>
                   <label style="font-size: 0.65rem; color: var(--text-secondary); display: block;">Cabin</label>
                   <input type="text" class="form-input inline-cabin-${uniqueId}" placeholder="7kg" value="${val.baggage_cabin || ''}" style="padding: 4px 6px; font-size: 0.75rem;" onblur="formatBaggageInput(this)">
                </div>
                <div>
                   <label style="font-size: 0.65rem; color: var(--text-secondary); display: block;">Check-in</label>
                   <input type="text" class="form-input inline-checkin-${uniqueId}" placeholder="15kg" value="${val.baggage_checkin || ''}" style="padding: 4px 6px; font-size: 0.75rem;" onblur="formatBaggageInput(this)">
                </div>
                <div>
                   <label style="font-size: 0.65rem; color: var(--text-secondary); display: block;">Pieces</label>
                   <input type="text" class="form-input inline-pcs-${uniqueId}" placeholder="2pcs" value="${val.baggage_pcs || ''}" style="padding: 4px 6px; font-size: 0.75rem;" onblur="formatPiecesInput(this)">
                </div>
             </div>
             <!-- Meal / Seat -->
             <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px;">
                <div>
                   <label style="font-size: 0.65rem; color: var(--text-secondary); display: block;">Seat</label>
                   <input type="text" class="form-input inline-seat-${uniqueId}" placeholder="A12" value="${val.seat || ''}" style="padding: 4px 6px; font-size: 0.75rem;">
                </div>
                <div>
                   <label style="font-size: 0.65rem; color: var(--text-secondary); display: block;">Meal</label>
                   <input type="text" class="form-input inline-meal-${uniqueId}" placeholder="Veg" value="${val.meal || ''}" style="padding: 4px 6px; font-size: 0.75rem;">
                </div>
             </div>
             <!-- Charges -->
             <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                <div>
                   <label style="font-size: 0.65rem; color: var(--text-secondary); display: block;">Cancel</label>
                   <input type="text" class="form-input inline-cancel-${uniqueId}" placeholder="3000" value="${val.cancellation_charges || ''}" style="padding: 4px 6px; font-size: 0.75rem;">
                </div>
                <div>
                   <label style="font-size: 0.65rem; color: var(--text-secondary); display: block;">Change</label>
                   <input type="text" class="form-input inline-penalty-${uniqueId}" placeholder="5000" value="${val.penalty_charges || ''}" style="padding: 4px 6px; font-size: 0.75rem;">
                </div>
             </div>
          </div>
        </div>
      `;
    }

    function toggleInlineFareDetails(detailsId) {
      const details = document.getElementById(detailsId);
      const icon = document.getElementById(`inline-toggle-icon-${detailsId}`);
      if (!details) return;

      if (details.style.display === 'none') {
        details.style.display = 'block';
        if (icon) icon.style.transform = 'rotate(180deg)';
      } else {
        details.style.display = 'none';
        if (icon) icon.style.transform = 'rotate(0deg)';
      }
    }

    function removeFareFromInline(uniqueId) {
      const card = document.getElementById(uniqueId);
      if (card) card.remove();
    }

    function changeInlineFareCardType(select, oldKey, flightIndex, suffix = '') {
      let newKey = select.value;
      let newLabel = select.options[select.selectedIndex].text;

      if (newKey === 'custom') {
        const customName = prompt("Enter Name for Custom Fare Type:");
        if (!customName || customName.trim() === '') {
          select.value = oldKey;
          return;
        }
        newLabel = customName.trim();
        newKey = newLabel.toLowerCase().replace(/\s+/g, '_');
        select.options[select.selectedIndex].value = newKey;
        select.options[select.selectedIndex].text = newLabel;
      }

      const oldUniqueId = `inline-fare-card-${oldKey}-${flightIndex}${suffix}`;
      const newUniqueId = `inline-fare-card-${newKey}-${flightIndex}${suffix}`;

      const card = document.getElementById(oldUniqueId);
      if (!card) return;

      if (document.getElementById(newUniqueId)) {
        showNotification('This fare type is already in the list!', 'error');
        select.value = oldKey;
        return;
      }

      // Update Card
      card.id = newUniqueId;
      card.dataset.fareKey = newKey;

      // Update Checkbox
      const chk = document.getElementById(`chk-${oldUniqueId}`);
      if (chk) {
        chk.id = `chk-${newUniqueId}`;
        chk.setAttribute('onchange', `toggleInlineFareCard(this, '${newKey}', ${flightIndex}, '${suffix}')`);
      }
      
      // Update delete button
      const delBtn = card.querySelector(`button[onclick="removeFareFromInline('${oldUniqueId}')"]`);
      if (delBtn) {
        delBtn.setAttribute('onclick', `removeFareFromInline('${newUniqueId}')`);
      }

      // Update Details section and toggle button
      const details = document.getElementById(`inline-details-${oldUniqueId}`);
      if (details) {
        details.id = `inline-details-${newUniqueId}`;
      }

      const btn = card.querySelector(`button[onclick="toggleFareDetails('inline-details-${oldUniqueId}')"]`);
      if (btn) {
        btn.setAttribute('onclick', `toggleFareDetails('inline-details-${newUniqueId}')`);
      }

      const icon = document.getElementById(`fare-toggle-icon-inline-details-${oldUniqueId}`);
      if (icon) {
        icon.id = `fare-toggle-icon-inline-details-${newUniqueId}`;
      }

      // Update all input classes
      const classMappings = ['inline-fare', 'inline-mu', 'inline-svc', 'inline-fare-cabin', 'inline-fare-checkin', 'inline-fare-pcs', 'inline-fare-seat', 'inline-fare-meal', 'inline-fare-cancellation', 'inline-fare-penalty'];
      classMappings.forEach(prefix => {
        const inputs = card.querySelectorAll(`.${prefix}-${oldUniqueId}`);
        inputs.forEach(inp => {
          inp.classList.remove(`${prefix}-${oldUniqueId}`);
          inp.classList.add(`${prefix}-${newUniqueId}`);
        });
      });
      
      select.setAttribute('onchange', `changeInlineFareCardType(this, '${newKey}', ${flightIndex}, '${suffix}')`);
    }

    function toggleInlineFareCard(checkbox, fareType, flightIndex, suffix = '') {
      const uniqueId = `inline-fare-card-${fareType}-${flightIndex}${suffix}`;
      const card = document.getElementById(uniqueId);
      const fareInput = document.querySelector(`.inline-fare-${uniqueId}`);
      const muInput = document.querySelector(`.inline-mu-${uniqueId}`);
      const svcInput = document.querySelector(`.inline-svc-${uniqueId}`);

      if (checkbox.checked) {
        card.classList.remove('disabled');
        fareInput.disabled = false;
        muInput.disabled = false;
        svcInput.disabled = false;
      } else {
        card.classList.add('disabled');
        fareInput.disabled = true;
        muInput.disabled = true;
        svcInput.disabled = true;
        fareInput.value = '';
        muInput.value = '';
        svcInput.value = '';
      }
    }

    function handleInlineAddFareType(select, flightIndex, suffix = '') {
      const val = select.value;
      if (!val) return;

      let key = val;
      const cabinLabels = {
        'economy': 'Economy',
        'premium_economy': 'Premium Economy',
        'business': 'Business Class',
        'first': 'First Class'
      };

      let label = cabinLabels[val] || (val.charAt(0).toUpperCase() + val.slice(1).replace('_', ' ') + ' Fare');

      if (val === 'custom') {
        const customName = prompt("Enter Name for Custom Fare Type:");
        if (!customName || customName.trim() === '') {
          select.value = '';
          return;
        }
        label = customName.trim();
        key = label.toLowerCase().replace(/\s+/g, '_');
      }

      const uniqueId = `inline-fare-card-${key}-${flightIndex}${suffix}`;
      // Check if exists
      if (document.getElementById(uniqueId)) {
        showNotification('Fare type already exists', 'warning');
        select.value = '';
        return;
      }

      // Add the new fare card
      const list = document.getElementById(`inline-fare-list-${flightIndex}${suffix}`);
      const div = document.createElement('div');
      div.innerHTML = createInlineFareCard(flightIndex, key, label, '', '', '', {}, true, suffix);
      list.appendChild(div.firstElementChild);

      select.value = '';
    }

    async function saveInlineFareChanges(flightIndex) {
      const flight = currentFlights[flightIndex];
      if (!flight) return;

      const isRoundTrip = currentTripType === 'round_trip' && currentFlights[flightIndex + 1];
      const isSplit = isRoundTrip && document.getElementById(`inline-split-toggle-${flightIndex}`)?.checked;
      const relatedFlightIndices = getRelatedFlightIndices(flightIndex);

      // Update the split flag
      if (isRoundTrip) {
        flight.is_split = isSplit;
      }

      // Helper to collect data from a specific list
      const collectData = (suffix) => {
        const fareCards = document.querySelectorAll(`#inline-fare-list-${flightIndex}${suffix} .fare-card`);
        const newFares = {};
        const newFareMU = {};
        const newFareSVC = {};
        const newFareExtras = {};
        const newFareOrder = [];
        const newFareLabels = {};
        let hasError = false;

        // Collect Date
        const dateInput = document.querySelector(`.inline-date-${flightIndex}${suffix}`);
        const newDate = dateInput ? dateInput.value.trim() : null;

        fareCards.forEach(card => {
          const checkbox = card.querySelector('.fare-card-header input[type="checkbox"]');
          if (!checkbox || !checkbox.checked) return;

          const fareKey = card.dataset.fareKey;
          const fareLabel = (card.querySelector('.fare-card-header label')?.textContent || fareKey).trim();
          newFareOrder.push(fareKey);
          newFareLabels[fareKey] = fareLabel;
          const uniqueId = `inline-fare-card-${fareKey}-${flightIndex}${suffix}`;
          const fareInput = document.querySelector(`.inline-fare-${uniqueId}`);
          const muInput = document.querySelector(`.inline-mu-${uniqueId}`);
          const svcInput = document.querySelector(`.inline-svc-${uniqueId}`);

          if (!fareInput || !fareInput.value || fareInput.value.trim() === '') {
            showNotification(`Please enter fare amount for ${fareKey}`, 'error');
            if (fareInput) fareInput.focus();
            hasError = true;
            return;
          }

          newFares[fareKey] = Number(fareInput.value);
          newFareMU[fareKey] = (muInput && muInput.value) ? Number(muInput.value) : 0;
          newFareSVC[fareKey] = (svcInput && svcInput.value) ? Number(svcInput.value) : 0;

          const cabinInp = card.querySelector(`.inline-cabin-${uniqueId}`);
          const checkinInp = card.querySelector(`.inline-checkin-${uniqueId}`);
          const pcsInp = card.querySelector(`.inline-pcs-${uniqueId}`);
          const seatInp = card.querySelector(`.inline-seat-${uniqueId}`);
          const mealInp = card.querySelector(`.inline-meal-${uniqueId}`);
          const cancelInp = card.querySelector(`.inline-cancel-${uniqueId}`);
          const penInp = card.querySelector(`.inline-penalty-${uniqueId}`);

          if (cabinInp?.value || checkinInp?.value || pcsInp?.value || seatInp?.value || mealInp?.value || cancelInp?.value || penInp?.value) {
            newFareExtras[fareKey] = {
              baggage_cabin: cabinInp?.value?.trim(),
              baggage_checkin: checkinInp?.value?.trim(),
              baggage_pcs: pcsInp?.value?.trim(),
              seat: seatInp?.value?.trim(),
              meal: mealInp?.value?.trim(),
              cancellation_charges: cancelInp?.value?.trim(),
              penalty_charges: penInp?.value?.trim()
            };
          }

        });
        return { newFares, newFareMU, newFareSVC, newFareExtras, newFareOrder, newFareLabels, newDate, hasError };
      };

      // Collect Main (Outbound/Shared)
      const mainSuffix = isRoundTrip ? '_out' : '';
      const mainData = collectData(mainSuffix);
      if (mainData.hasError) return;

      // Save to main flight
      flight.fares = mainData.newFares;
      flight.fare_mu = mainData.newFareMU;
      flight.fare_svc = mainData.newFareSVC;
      flight.fare_extra_details = mainData.newFareExtras;
      flight.fare_order = mainData.newFareOrder;
      flight.fare_labels = mainData.newFareLabels;

      if (isRoundTrip) {
        const returnFlight = currentFlights[flightIndex + 1];
        if (isSplit) {
          // Collect Return
          const retData = collectData('_ret');
          if (retData.hasError) return;

          returnFlight.fares = retData.newFares;
          returnFlight.fare_mu = retData.newFareMU;
          returnFlight.fare_svc = retData.newFareSVC;
          returnFlight.fare_extra_details = retData.newFareExtras;
          returnFlight.fare_order = retData.newFareOrder;
          returnFlight.fare_labels = retData.newFareLabels;
        } else {
          // Copy Main to Return, BUT KEEP RETURN DATE if it exists and wasn't edited in shared mode?
          // If shared mode, we only displayed one date input (main).
          // Assuming shared date input applies to OUTBOUND only?
          // Or should we have displayed two date inputs even in combined mode?
          // The generator uses generateSectionHTML(flight...) and generateSectionHTML(returnFlight...)
          // In combined mode (`isSplit` false), `generateSectionHTML` is called for `flight` (Main) using `_out` suffix (lines 6361).
          // And `returnFlight` section is HIDDEN if `isSplit` is false (line 6362).
          // Wait, `isSplit` affects `display: none` of the return section.
          // IF HIDDEN, the user CANNOT edit the return date.
          // This is a logic gap. A user might want same fares but different dates (obviously).
          // FIX: Always show the Return Date input?
          // Or separate the Date Input from the Fare Section?
          // For now, I will ensure that if `isSplit` is false (Combined Fares), we DO NOT overwrite the Return Date with the Main Date (which makes no sense).
          // But wait, if the section is hidden, `collectData('_ret')` will still find element if it's in DOM (just hidden).
          // Correct. `display: none` elements are still found by querySelector.
          // So if the user edits the main date, and the return section is hidden, the return date input (hidden) remains unchanged.
          // `collectData('_ret')` will pick up the hidden return date.
          // So we should capture it.

          const retData = collectData('_ret'); // This captures the hidden return date input

          returnFlight.fares = JSON.parse(JSON.stringify(mainData.newFares));
          returnFlight.fare_mu = JSON.parse(JSON.stringify(mainData.newFareMU));
          returnFlight.fare_svc = JSON.parse(JSON.stringify(mainData.newFareSVC));
          returnFlight.fare_extra_details = JSON.parse(JSON.stringify(mainData.newFareExtras));
          returnFlight.fare_order = JSON.parse(JSON.stringify(mainData.newFareOrder));
          returnFlight.fare_labels = JSON.parse(JSON.stringify(mainData.newFareLabels));
        }
      }

      const labelMap = {
        economy: 'Economy',
        premium_economy: 'Premium Economy',
        business: 'Business Class',
        first: 'First Class'
      };
      relatedFlightIndices.forEach(idx => {
        const targetFlight = currentFlights[idx];
        if (!targetFlight) return;

        const flightKey = `${idx}:flight`;
        if (Object.prototype.hasOwnProperty.call(pendingCabinSelections, flightKey)) {
          const normalized = pendingCabinSelections[flightKey];
          if (normalized) {
            targetFlight.cabin_class = normalized;
            targetFlight.class_of_travel = labelMap[normalized] || 'Economy';
            targetFlight.show_cabin_class = true;
          } else {
            delete targetFlight.cabin_class;
            delete targetFlight.class_of_travel;
            targetFlight.show_cabin_class = false;
          }
        }

        (targetFlight.segments || []).forEach((segment, segIdx) => {
          const segmentKey = `${idx}:${segIdx}`;
          if (!Object.prototype.hasOwnProperty.call(pendingCabinSelections, segmentKey)) return;
          const normalized = pendingCabinSelections[segmentKey];
          if (normalized) {
            segment.cabin_class = normalized;
            segment.class_of_travel = labelMap[normalized] || 'Economy';
            segment.show_booking_class = true;
          } else {
            delete segment.cabin_class;
            delete segment.class_of_travel;
            segment.show_booking_class = false;
          }
        });
      });

      // Check if dates were changed and trigger recalculation if so
      const needsRecalc = [];
      if (mainData.newDate && mainData.newDate !== flight.departure_date) {
        flight.departure_date = mainData.newDate;
        needsRecalc.push(flightIndex);
      }
      if (isRoundTrip) {
        const returnFlight = currentFlights[flightIndex + 1];
        const retData = collectData('_ret');
        if (retData.newDate && retData.newDate !== returnFlight.departure_date) {
          returnFlight.departure_date = retData.newDate;
          needsRecalc.push(flightIndex + 1);
        }
      }

      if (needsRecalc.length > 0) {
        await recalculateMultipleFlights(needsRecalc);
      } else {
        renderResults(currentFlights);
        regenerateOutputText();
      }

      showNotification('Fares updated successfully', 'success');
      relatedFlightIndices.forEach(idx => {
        activeCabinEditorFlights.delete(idx);
        clearPendingCabinSelections(idx);
      });
      renderResults(currentFlights);
    }


    async function deleteFlightOption(index) {
      const confirmed = await showDeleteModal('Delete Flight Option', 'Are you sure you want to delete this Entire Flight Option and its fares? This cannot be undone.');
      if (!confirmed) {
        return;
      }

      // Hide editor if open for this index
      const editor = document.getElementById(`inline-editor-${index}`);
      if (editor) editor.style.display = 'none';

      // Remove from currentFlights
      currentFlights.splice(index, 1);

      // Update unitFlights mapping (re-index all references)
      const newUnitFlights = {};
      Object.entries(unitFlights).forEach(([unitId, ids]) => {
        const newIds = ids
          .map(id => id === index ? null : (id > index ? id - 1 : id))
          .filter(id => id !== null);

        if (newIds.length > 0) {
          newUnitFlights[unitId] = newIds;
        }
      });
      unitFlights = newUnitFlights;

      // Re-render
      renderResults(currentFlights);
      regenerateOutputText();

      showNotification('Flight option deleted successfully', 'success');

      // Re-apply global edit mode state if active
      if (isGlobalEditMode) {
        currentFlights.forEach((f, idx) => {
          if (f.is_editable) {
            const editBar = document.getElementById(`card-edit-bar-${idx}`);
            if (editBar) editBar.style.display = 'flex';
          }
        });
      }
    }

    function removeFareFromOption(flightIndex, fareKey) {
      const card = document.getElementById(`inline-fare-card-${fareKey}-${flightIndex}`);
      if (card) {
        card.style.transition = 'all 0.3s ease';
        card.style.opacity = '0';
        card.style.transform = 'translateX(20px)';
        setTimeout(() => {
          card.remove();
        }, 300);
      }
    }

    function getAirlinesForOption(flights) {
      if (!flights || flights.length === 0) return '';
      const airlines = new Set();
      flights.forEach(f => {
        if (!f) return;
        if (f.segments && f.segments.length > 0) {
          f.segments.forEach(s => { if (s.airline && s.airline !== 'N/A') airlines.add(s.airline); });
        } else if (f.airline && f.airline !== 'N/A') {
          airlines.add(f.airline);
        }
      });
      if (airlines.size === 0) return '';
      return ` (${Array.from(airlines).join(' & ')})`;
    }

    function getCabinLabelForOutput(val) {
      if (!val) return '';
      const raw = val.toString().trim().toLowerCase();
      if (!raw || raw === 'none' || raw === 'n/a') return '';
      if (raw.includes('premium')) return 'Premium Economy';
      if (raw.includes('business')) return 'Business Class';
      if (raw.includes('first')) return 'First Class';
      if (raw.includes('economy')) return 'Economy';
      return '';
    }

    function formatFlightOutput(flight, flightNumber) {
      const dateDisplay = !flight.departure_date || flight.departure_date === 'N/A' ? '[DATE TO BE CONFIRMED]' : flight.departure_date;

      // Check if we have segments (layover/connecting flights)
      const hasSegments = flight.segments && flight.segments.length > 1;

      let output = '';

      // Option header
      const timeCat = getTimeCategory(flight.departure_time);
      const airlineStr = getAirlinesForOption([flight]);
      output += `*OPTION ${flightNumber}${timeCat ? ' - ' + timeCat : ''}${airlineStr}*\n\n`;

      // Route line without emoji
      output += `Flight from ${flight.departure_city} (${flight.departure_airport}) to ${flight.arrival_city} (${flight.arrival_airport}) — *${dateDisplay}*\n\n`;

      if (hasSegments) {
        // Multi-segment flight with layovers
        flight.segments.forEach((seg, idx) => {
          const rawCabin = seg.cabin_class || seg.class_of_travel || flight.cabin_class || flight.class_of_travel;
          const cabinClass = getCabinLabelForOutput(rawCabin);
          const classStr = cabinClass ? ` [${cabinClass}]` : '';
          output += `*${seg.airline || flight.airline} ${seg.flight_number || ''}*${classStr}\n`;
          output += `*${seg.departure_airport}* ${seg.departure_time} → *${seg.arrival_airport}* ${seg.arrival_time}\n`;
          if (isFieldValid(seg.duration)) output += `Duration: *${seg.duration}*\n`;

          // Add layover info if not the last segment
          if (idx < flight.segments.length - 1) {
            const nextSeg = flight.segments[idx + 1];
            const layoverCity = nextSeg.departure_city || nextSeg.departure_airport || seg.arrival_city || seg.arrival_airport;
            let layoverDur = nextSeg.layover_duration || '';

            if (!isFieldValid(layoverDur)) {
              const layoverDiff = calculateTimeDiff(seg.arrival_time, nextSeg.departure_time);
              if (layoverDiff) layoverDur = layoverDiff.text;
            }

            output += `\n*Layover:* ${layoverCity}`;
            if (isFieldValid(layoverDur)) output += ` — *${layoverDur}*`;
            output += `\n\n`;
          }
        });
      } else {
        // Single segment flight or fallback
        const rawCabin = flight.cabin_class || flight.class_of_travel;
        const cabinClass = getCabinLabelForOutput(rawCabin);
        const classStr = cabinClass ? ` [${cabinClass}]` : '';
        output += `*${flight.airline} ${flight.flight_number}*${classStr}\n`;
        output += `*${flight.departure_airport}* ${flight.departure_time} → *${flight.arrival_airport}* ${flight.arrival_time}\n`;
        if (isFieldValid(flight.duration)) output += `Duration: *${flight.duration}*\n`;

        if (isFieldValid(flight.stops) && flight.stops !== '0 stops') {
          output += `${flight.stops}\n`;
        } else {
          output += `Non Stop\n`;
        }
      }

      output += `\n`;

      // Fares (no dash separator)
      getOrderedFareEntries(flight).forEach(([type, base]) => {
        const perFareMU = flight.fare_mu && flight.fare_mu[type] !== undefined ? flight.fare_mu[type] : (flight.markup || 0);
        const finalFare = base + perFareMU;
        const perFareSVC = flight.fare_svc && flight.fare_svc[type] !== undefined ? flight.fare_svc[type] : (flight.service_charge || 0);
        const perFareGST = perFareSVC > 0 ? Math.round(perFareSVC * 0.18) : 0;

        let svcText = '';
        if (perFareSVC > 0) {
          svcText = ` (+ ₹${perFareSVC} SVC + ₹${perFareGST} GST)`;
        }
        output += `*${getFareDisplayLabel(flight, type)}:* ₹${finalFare.toLocaleString('en-IN')}${svcText} per pax\n`;

        // Add baggage/extra info on new lines
        if (flight.fare_extra_details && flight.fare_extra_details[type]) {
          const d = flight.fare_extra_details[type];

          // 1. Baggage Row
          const bagParts = [];
          if (d.baggage_cabin) bagParts.push(`Cabin: ${d.baggage_cabin}`);
          if (d.baggage_checkin) bagParts.push(`Check-in: ${d.baggage_checkin}`);
          if (d.baggage_pcs) bagParts.push(`Pcs: ${d.baggage_pcs}`);
          if (bagParts.length > 0) output += `*Baggage:* ${bagParts.join(' | ')}\n`;

          // 2. Meal Row
          if (d.meal) output += `*Meal:* ${d.meal}\n`;

          // 3. Seat Row
          if (d.seat) output += `*Seat:* ${d.seat}\n`;

          // 4. Cancellation Charges
          if (d.cancellation_charges) {
            const hasNumbers = /\d/.test(d.cancellation_charges);
            const suffix = hasNumbers ? ' + GST per pax' : '';
            output += `*Cancellation Charges:* ${d.cancellation_charges}${suffix}\n`;
          }

          // 5. Change Penalty
          if (d.penalty_charges) {
            const hasNumbers = /\d/.test(d.penalty_charges);
            const suffix = hasNumbers ? ' + GST per pax' : '';
            output += `*Changes Penalty:* ${d.penalty_charges}${suffix}\n`;
          }
        }
        output += `\n`;
      });

      return output;
    }

    function formatFlightOutputWithoutFares(flight, flightNumber) {
      const dateDisplay = !flight.departure_date || flight.departure_date === 'N/A' ? '[DATE TO BE CONFIRMED]' : flight.departure_date;

      let out = `Flight from ${flight.departure_city} (${flight.departure_airport}) to ${flight.arrival_city} (${flight.arrival_airport}) — *${dateDisplay}*\n\n`;

      if (flight.segments && flight.segments.length > 1) {
        // Multi-segment detailed layout
        flight.segments.forEach((seg, idx) => {
          // Segment Details
          const rawCabin = seg.cabin_class || seg.class_of_travel || flight.cabin_class || flight.class_of_travel;
          const cabinClass = getCabinLabelForOutput(rawCabin);
          const classStr = cabinClass ? ` [${cabinClass}]` : '';
          out += `*${seg.airline || flight.airline} ${seg.flight_number || ''}*${classStr}\n`;
          out += `*${seg.departure_airport}* ${seg.departure_time} → *${seg.arrival_airport}* ${seg.arrival_time}\n`;
          if (isFieldValid(seg.duration)) out += `Duration: *${seg.duration}*\n`;

          // Layover Info
          if (idx < flight.segments.length - 1) {
            const nextSeg = flight.segments[idx + 1];
            const layoverCity = nextSeg.departure_city || nextSeg.departure_airport;
            const layoverDur = nextSeg.layover_duration || '';

            out += `\n*Layover:* ${layoverCity}`;
            if (layoverDur && layoverDur !== 'N/A') out += ` — *${layoverDur}*`;
            out += `\n\n`;
          }
        });

      } else {
        const rawCabin = flight.cabin_class || flight.class_of_travel;
        const cabinClass = getCabinLabelForOutput(rawCabin);
        const classStr = cabinClass ? ` [${cabinClass}]` : '';
        out += `*${flight.airline} ${flight.flight_number}*${classStr}\n`;
        out += `*${flight.departure_airport}* ${flight.departure_time} → *${flight.arrival_airport}* ${flight.arrival_time}\n`;
        if (isFieldValid(flight.duration)) out += `Duration: *${flight.duration}*\n`;

        if (isFieldValid(flight.stops) && flight.stops !== '0 stops') {
          out += `${flight.stops}\n`;
        } else {
          out += `Non Stop\n`;
        }
      }
      return out;
    }

    function formatFaresOutput(flight) {
      let fareLines = '';
      getOrderedFareEntries(flight).forEach(([type, base]) => {
        // Use per-fare markup if available, otherwise use global markup
        const perFareMU = flight.fare_mu && flight.fare_mu[type] !== undefined ? flight.fare_mu[type] : (flight.markup || 0);
        const finalFare = base + perFareMU;

        // Use per-fare SVC if available, otherwise use global SVC
        const perFareSVC = flight.fare_svc && flight.fare_svc[type] !== undefined ? flight.fare_svc[type] : (flight.service_charge || 0);
        const perFareGST = perFareSVC > 0 ? Math.round(perFareSVC * 0.18) : 0;

        let extraText = '';
        if (perFareSVC > 0) {
          extraText = ` (+ ₹${perFareSVC} SVC + ₹${perFareGST} GST)`;
        }

        fareLines += `*${getFareDisplayLabel(flight, type)}:* ₹${finalFare.toLocaleString('en-IN')}${extraText} per pax\n`;

        // Add baggage/extra info on new lines
        if (flight.fare_extra_details && flight.fare_extra_details[type]) {
          const d = flight.fare_extra_details[type];

          // 1. Baggage Row
          const bagParts = [];
          if (d.baggage_cabin) bagParts.push(`Cabin: ${d.baggage_cabin}`);
          if (d.baggage_checkin) bagParts.push(`Check-in: ${d.baggage_checkin}`);
          if (d.baggage_pcs) bagParts.push(`Pcs: ${d.baggage_pcs}`);
          if (bagParts.length > 0) fareLines += `*Baggage:* ${bagParts.join(' | ')}\n`;

          // 2. Meal Row
          if (d.meal) fareLines += `*Meal:* ${d.meal}\n`;

          // 3. Seat Row
          if (d.seat) fareLines += `*Seat:* ${d.seat}\n`;

          // 4. Cancellation Charges
          if (d.cancellation_charges) {
            const hasNumbers = /\d/.test(d.cancellation_charges);
            const suffix = hasNumbers ? ' + GST per pax' : '';
            fareLines += `*Cancellation Charges:* ${d.cancellation_charges}${suffix}\n`;
          }

          // 5. Change Penalty
          if (d.penalty_charges) {
            const hasNumbers = /\d/.test(d.penalty_charges);
            const suffix = hasNumbers ? ' + GST per pax' : '';
            fareLines += `*Changes Penalty:* ${d.penalty_charges}${suffix}\n`;
          }
        }
        fareLines += `\n`;
      });
      return fareLines;
    }

    function promptDateInput(flightIndex) {
      const flight = currentFlights[flightIndex];
      const today = new Date();
      const minDate = today.toISOString().split('T')[0];

      // Create modal for date input
      const modalHTML = `
    <div id="dateModal" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 10000;">
      <div style="background: var(--bg-card); padding: 2rem; border-radius: 0.8rem; box-shadow: 0 4px 6px rgba(0,0,0,0.1); max-width: 400px; width: 90%;">
        <h3 style="margin: 0 0 1rem 0; color: var(--primary);">📅 Enter Flight Date</h3>
        <p style="color: var(--text-secondary); margin-bottom: 1.5rem; font-size: 0.95rem;">
          ${flight.airline} ${flight.flight_number}<br/>
          <strong>${flight.departure_city} → ${flight.arrival_city}</strong>
        </p>
        
        <input type="date" id="flightDateInput" min="${minDate}" style="width: 100%; padding: 0.8rem; border: 2px solid var(--border); border-radius: 0.4rem; font-size: 1rem; box-sizing: border-box; margin-bottom: 1rem; background: var(--bg-card); color: var(--text-primary);" />
        
        <div style="display: flex; gap: 1rem; justify-content: flex-end;">
          <button onclick="closeDateModal()" style="padding: 0.6rem 1.2rem; background: var(--bg-main); border: none; border-radius: 0.3rem; cursor: pointer; color: var(--text-primary);">Cancel</button>
          <button onclick="saveDateInput(${flightIndex})" style="padding: 0.6rem 1.2rem; background: var(--primary); color: white; border: none; border-radius: 0.3rem; cursor: pointer; font-weight: bold;">Save Date</button>
        </div>
      </div>
    </div>
  `;

      document.body.insertAdjacentHTML('beforeend', modalHTML);
      document.getElementById('flightDateInput').focus();
    }

    function closeDateModal() {
      const modal = document.getElementById('dateModal');
      if (modal) modal.remove();
    }

    function regenerateOutputText(onlyUpdatePassengers = false) {
      if (!currentFlights || currentFlights.length === 0) {
        console.log('No current flights available');
        return;
      }

      if (onlyUpdatePassengers && currentFinalText) {
        let cleanText = currentFinalText.trim();
        cleanText = cleanText.replace(/^Kindly check the below options and confirm to issue\n*/i, '');
        cleanText = cleanText.replace(/^\*Passengers:\*[^\n]*\n*/i, '').trim();
        
        let newHeader = 'Kindly check the below options and confirm to issue\n\n';
        if (savePassengers && savePassengers.length > 0) {
          const names = savePassengers.map(p => p.first_name + ' ' + (p.last_name || '')).join(', ');
          newHeader += `*Passengers:* ${names}\n\n`;
        }
        currentFinalText = newHeader + cleanText;
        const outputElement = document.getElementById("output");
        if (outputElement) {
          outputElement.textContent = currentFinalText;
        }
        return;
      }

      let output = 'Kindly check the below options and confirm to issue\n\n';
      // Header removed for consistency

      if (savePassengers && savePassengers.length > 0) {
        const names = savePassengers.map(p => p.first_name + ' ' + (p.last_name || '')).join(', ');
        output += `*Passengers:* ${names}\n\n`;
      }

      if (currentTripType === 'round_trip') {
        let flightIdx = 0;
        Object.entries(unitFlights).forEach(([unitId, flightIds]) => {
          if (flightIds.length === 2) {
            // Define flights locally
            const outboundFlight = currentFlights[flightIdx];
            const returnFlight = currentFlights[flightIdx + 1];

            const airlineStr = getAirlinesForOption([outboundFlight, returnFlight]);
            const headerText = `*ROUND TRIP OPTION ${unitId}${airlineStr}*`;
            const separator = '_________________________';
            output += `\n${headerText}\n${separator}\n\n`;

            // Deep comparison helper for fares
            const areFaresInitiallySame = (f1, f2) => {
              const k1 = Object.keys(f1).sort();
              const k2 = Object.keys(f2).sort();
              if (k1.length !== k2.length) return false;
              if (!k1.every((key, i) => key === k2[i])) return false;
              return k1.every(key => f1[key] === f2[key]);
            };

            // Are fares different (Split Mode)?
            const areFaresDifferent = (outboundFlight.is_split === true) || !areFaresInitiallySame(outboundFlight.fares, returnFlight.fares);

            if (areFaresDifferent) {
              // Split Logic for Output Text

              // Outbound
              output += `*✈️ OUTBOUND FLIGHT*\n\n`;
              output += formatFlightOutputWithoutFares(outboundFlight, flightIdx + 1);
              output += `\n`; // Just separation
              output += formatFaresOutput(outboundFlight);
              output += `\n`;

              // Return
              output += `\n*✈️ RETURN FLIGHT*\n\n`;
              output += formatFlightOutputWithoutFares(returnFlight, flightIdx + 2);
              output += `\n`; // Just separation
              output += formatFaresOutput(returnFlight);

            } else {
              // Combined Logic (Existing)

              // Outbound flight - WITHOUT fares
              output += `*✈️ OUTBOUND FLIGHT*\n\n`;
              output += formatFlightOutputWithoutFares(outboundFlight, flightIdx + 1);

              // Return flight - WITHOUT fares
              output += `\n*✈️ RETURN FLIGHT*\n\n`;
              output += formatFlightOutputWithoutFares(returnFlight, flightIdx + 2);

              // Show fares ONCE for the entire option
              output += `\n*ROUND TRIP FARE*\n`;
              output += formatFaresOutput(outboundFlight);
            }

            flightIdx += 2;
          }
        });
      } else if (currentTripType === 'multi_city') {
        let flightIdx = 0;
        Object.entries(unitFlights).forEach(([unitId, flightIds]) => {
          const multiCityFlights = flightIds.map(idx => currentFlights[idx]).filter(Boolean);
          const airlineStr = getAirlinesForOption(multiCityFlights);
          const headerText = `*MULTI-CITY OPTION ${unitId}${airlineStr}*`;
          const separator = '_________________________';
          output += `\n${headerText}\n${separator}\n\n`;

          flightIds.forEach((fid, cityIdx) => {
            if (flightIdx < currentFlights.length) {
              output += `*✈️ FLIGHT ${cityIdx + 1}*\n\n`;
              const flight = currentFlights[flightIdx];
              // Show flight WITHOUT fares
              output += formatFlightOutputWithoutFares(flight, flightIdx + 1);
              output += '\n';
              flightIdx++;
            }
          });

          // Show fares ONCE for the entire option
          if (flightIdx > 0) {
            output += `*FARES FOR THIS OPTION:*\n`;
            output += formatFaresOutput(currentFlights[flightIdx - 1]);
          }
        });
      } else {
        currentFlights.forEach((flight, index) => {
          output += formatFlightOutput(flight, index + 1);
          if (index < currentFlights.length - 1) {
            output += '\n';
          }
        });
      }

      output += `\n\n*Please Note:*\n_Timings mentioned are in 24 hours clock_\n_No booking has been made yet_\n_Rates and inventory are subject to availability at the time of final booking_`;

      currentFinalText = output.trim();
      const outputElement = document.getElementById("output");
      if (outputElement) {
        outputElement.textContent = currentFinalText;
        console.log('Output text updated');
      }
    }

    async function recalculateFlight(index, skipRender = false) {
      const flight = currentFlights[index];
      if (!flight || !flight.departure_date || flight.departure_date === 'N/A') return;

      try {
        const response = await fetch('/api/recalculate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ flight, new_date: flight.departure_date })
        });
        const data = await response.json();
        if (data.flight) {
          // Keep the existing ID and editable status if they were lost or different
          const oldId = flight.id;
          const oldEditable = flight.is_editable;
          const oldFares = flight.fares;
          const oldFareMu = flight.fare_mu;
          const oldFareSvc = flight.fare_svc;
          const oldFareExtras = flight.fare_extra_details;
          const oldUnitId = normalizeUnitIdValue(flight.unit_id || flight.unitId || '1');

          currentFlights[index] = data.flight;

          // Restore UI state fields
          currentFlights[index].id = oldId;
          currentFlights[index].is_editable = oldEditable;
          currentFlights[index].fares = oldFares;
          currentFlights[index].fare_mu = oldFareMu;
          currentFlights[index].fare_svc = oldFareSvc;
          currentFlights[index].fare_extra_details = oldFareExtras;
          currentFlights[index].unit_id = oldUnitId;
          currentFlights[index].unitId = oldUnitId;

          if (!skipRender) {
            renderResults(currentFlights);
            regenerateOutputText();
          }
        }
      } catch (e) {
        console.error('Recalculation failed:', e);
      }
    }

    async function recalculateMultipleFlights(indices) {
      if (!indices || indices.length === 0) return;

      showLoader(); // Need to ensure showLoader exists or just use a flag

      const promises = indices.map(idx => recalculateFlight(idx, true));
      await Promise.all(promises);

      renderResults(currentFlights);
      regenerateOutputText();
      hideLoader();
    }

    async function saveDateInput(flightIndex) {
      const dateInput = document.getElementById('flightDateInput');
      const selectedDate = dateInput.value.trim();

      if (!selectedDate) {
        showNotification('Please select a date', 'error');
        return;
      }

      // Convert YYYY-MM-DD to "DD Mon YYYY" format
      const dateParts = selectedDate.split('-');
      const dateObj = new Date(dateParts[0], dateParts[1] - 1, dateParts[2]);
      const options = { day: '2-digit', month: 'short', year: 'numeric' };
      const formattedDate = dateObj.toLocaleDateString('en-GB', options).replace(/\s+/g, ' ');

      console.log('Saving date:', formattedDate, 'for flight index:', flightIndex);

      // Update the flight data
      if (currentFlights && currentFlights[flightIndex]) {
        currentFlights[flightIndex].departure_date = formattedDate;

        // Recalculate flight details (duration, offsets, layovers)
        await recalculateFlight(flightIndex);

        // Remove the "Enter Date" warning strip if it exists
        const warningStrip = document.getElementById(`date-warning-${flightIndex}`);
        if (warningStrip) {
          warningStrip.remove();
        }

        showNotification(`Date set to ${formattedDate}`, 'success');

        // Helper to check if two flights are on the same leg
        const getIndexInUnit = (idx) => {
            if (!currentFlights[idx]) return 0;
            const unitId = currentFlights[idx].unit_id || currentFlights[idx].unitId || '1';
            let indexInUnit = 0;
            for (let i = 0; i < idx; i++) {
                if ((currentFlights[i].unit_id || currentFlights[i].unitId || '1') === unitId) {
                    indexInUnit++;
                }
            }
            return indexInUnit;
        };

        const shouldApplySameDate = (idxA, idxB) => {
            const tripRadio = document.querySelector('input[name="tripType"]:checked');
            const tripType = tripRadio ? tripRadio.value : 'one_way';
            if (tripType === 'one_way') return true;
            return getIndexInUnit(idxA) === getIndexInUnit(idxB);
        };

        // Check if there are other flights without dates on the same leg
        const flightsWithoutDate = currentFlights.filter((f, idx) =>
          idx !== flightIndex && 
          (!f.departure_date || f.departure_date === 'N/A') &&
          shouldApplySameDate(idx, flightIndex)
        );

        if (flightsWithoutDate.length > 0) {
          // Close current modal first
          closeDateModal();

          // Show prompt to apply date to other flights
          setTimeout(() => {
            showApplyDatePrompt(formattedDate, flightIndex, selectedDate);
          }, 300);
          return;
        }
      } else {
        console.log('currentFlights not available or index out of range');
        showNotification('Error updating flight', 'error');
      }

      closeDateModal();
    }

    function showApplyDatePrompt(formattedDate, excludeIndex, rawDate) {
      const editedFlight = currentFlights[excludeIndex];
      const getIndexInUnit = (idx) => {
          if (!currentFlights[idx]) return 0;
          const unitId = currentFlights[idx].unit_id || currentFlights[idx].unitId || '1';
          let indexInUnit = 0;
          for (let i = 0; i < idx; i++) {
              if ((currentFlights[i].unit_id || currentFlights[i].unitId || '1') === unitId) {
                  indexInUnit++;
              }
          }
          return indexInUnit;
      };

      const shouldApplySameDate = (idxA, idxB) => {
          const tripRadio = document.querySelector('input[name="tripType"]:checked');
          const tripType = tripRadio ? tripRadio.value : 'one_way';
          if (tripType === 'one_way') return true;
          return getIndexInUnit(idxA) === getIndexInUnit(idxB);
      };

      const flightsWithoutDate = currentFlights
        .map((f, idx) => ({ flight: f, index: idx }))
        .filter(item => 
            item.index !== excludeIndex && 
            (!item.flight.departure_date || item.flight.departure_date === 'N/A') &&
            shouldApplySameDate(item.index, excludeIndex)
        );

      if (flightsWithoutDate.length === 0) return;

      const count = flightsWithoutDate.length;
      const modalHTML = `
        <div id="applyDateModal" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 10000;">
          <div style="background: var(--bg-card); padding: 2rem; border-radius: 0.8rem; box-shadow: 0 4px 6px rgba(0,0,0,0.1); max-width: 450px; width: 90%;">
            <h3 style="margin: 0 0 1rem 0; color: var(--primary);">📅 Apply Date to Other Flights?</h3>
            <p style="color: var(--text-secondary); margin-bottom: 1.5rem; font-size: 0.95rem;">
              You have <strong>${count} other flight${count > 1 ? 's' : ''}</strong> on this same leg without a date set.<br><br>
              Would you like to apply <strong>${formattedDate}</strong> to ${count > 1 ? 'all of them' : 'it'}?
            </p>
            
            <div style="display: flex; gap: 1rem; justify-content: flex-end; flex-wrap: wrap;">
              <button onclick="closeApplyDateModal()" style="padding: 0.6rem 1.2rem; background: var(--bg-main); border: none; border-radius: 0.3rem; cursor: pointer; color: var(--text-primary);">No, I'll set them manually</button>
              <button onclick="applyDateToAllFlights('${formattedDate}', ${excludeIndex})" style="padding: 0.6rem 1.2rem; background: var(--primary); color: white; border: none; border-radius: 0.3rem; cursor: pointer; font-weight: bold;">Yes, apply to all</button>
            </div>
          </div>
        </div>
      `;

      document.body.insertAdjacentHTML('beforeend', modalHTML);
    }

    function closeApplyDateModal() {
      const modal = document.getElementById('applyDateModal');
      if (modal) modal.remove();
    }

    async function applyDateToAllFlights(formattedDate, excludeIndex) {
      let updatedIndices = [];
      const editedFlight = currentFlights[excludeIndex];
      const getIndexInUnit = (idx) => {
          if (!currentFlights[idx]) return 0;
          const unitId = currentFlights[idx].unit_id || currentFlights[idx].unitId || '1';
          let indexInUnit = 0;
          for (let i = 0; i < idx; i++) {
              if ((currentFlights[i].unit_id || currentFlights[i].unitId || '1') === unitId) {
                  indexInUnit++;
              }
          }
          return indexInUnit;
      };

      const shouldApplySameDate = (idxA, idxB) => {
          const tripRadio = document.querySelector('input[name="tripType"]:checked');
          const tripType = tripRadio ? tripRadio.value : 'one_way';
          if (tripType === 'one_way') return true;
          return getIndexInUnit(idxA) === getIndexInUnit(idxB);
      };

      currentFlights.forEach((flight, idx) => {
        if (idx !== excludeIndex && (!flight.departure_date || flight.departure_date === 'N/A') && shouldApplySameDate(idx, excludeIndex)) {
          flight.departure_date = formattedDate;
          updatedIndices.push(idx);

          // Remove warning strip
          const warningStrip = document.getElementById(`date-warning-${idx}`);
          if (warningStrip) {
            warningStrip.remove();
          }
        }
      });

      if (updatedIndices.length > 0) {
        await recalculateMultipleFlights(updatedIndices);
      } else {
        regenerateOutputText();
      }

      closeApplyDateModal();
      showNotification(`Date applied to ${updatedIndices.length} flight${updatedIndices.length > 1 ? 's' : ''}!`, 'success');
    }

    function toggleDetails(id) {
      const timeline = document.getElementById(`timeline-${id}`);
      const arrow = document.getElementById(`arrow-${id}`);

      if (timeline && timeline.style.display === 'none') {
        timeline.style.display = 'block';
        if (arrow) arrow.classList.add('rotated');
      } else if (timeline) {
        timeline.style.display = 'none';
        if (arrow) arrow.classList.remove('rotated');
      }
      cardsImageBlobCache.clear();
      lastPreloadKey = '';
      scheduleCardsImagePreload();
    }

    function animateButton(btn, text, icon = '✅') {
      if (!btn) return;
      const originalHtml = btn.innerHTML;

      // Visual feedback
      btn.classList.add('btn-animate-click');
      btn.innerHTML = `<span>${icon} ${text}</span>`;

      // Green color theme for success
      btn.style.setProperty('background', '#10b981', 'important');
      btn.style.setProperty('border-color', '#10b981', 'important');
      btn.style.setProperty('color', '#ffffff', 'important');
      btn.style.setProperty('box-shadow', '0 0 15px rgba(16, 185, 129, 0.4)', 'important');

      setTimeout(() => {
        btn.classList.remove('btn-animate-click');
        setTimeout(() => {
          btn.innerHTML = originalHtml;
          btn.style.background = '';
          btn.style.borderColor = '';
          btn.style.color = '';
          btn.style.boxShadow = '';
        }, 2000);
      }, 300);
    }

    function copyOutput(btn) {
      if (document.activeElement) document.activeElement.blur();
      // Use currentFinalText which is the properly formatted output
      const output = currentFinalText || document.getElementById("output").textContent;

      if (!output || output === 'No output yet.') {
        showNotification('No itinerary to copy. Parse flights first.', 'warning');
        return;
      }

      // Try modern clipboard API first
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(output).then(() => {
          showNotification('Copied to clipboard!', 'success');
          animateButton(btn, 'Copied');
          setTimeout(() => submitItinerary(true), 0); // Fire-and-forget autosave
        }).catch((err) => {
          console.error('Clipboard API failed', err);
          fallbackCopy(output, btn);
        });
      } else {
        fallbackCopy(output, btn);
      }
    }

    function fallbackCopy(text, btn) {
      // Fallback for older browsers or when clipboard API is not available
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();

      try {
        const successful = document.execCommand('copy');
        if (successful) {
          showNotification('Copied to clipboard!', 'success');
          if (btn) {
            animateButton(btn, 'Copied');
            setTimeout(() => submitItinerary(true), 0); // Fire-and-forget autosave
          }
        } else {
          showNotification('Failed to copy. Please select and copy manually.', 'error');
        }
      } catch (e) {
        console.error('Fallback copy failed', e);
        showNotification('Failed to copy. Please select and copy manually.', 'error');
      }

      document.body.removeChild(textarea);
    }

    function getExportStyleMarkup() {
      const styleTags = Array.from(document.head.querySelectorAll('style'))
        .map(node => node.outerHTML)
        .join('\n');
      const exportOverrides = `
        <style>
          #cards, #cards * {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Arial, sans-serif !important;
          }
          #cards .flight-code,
          #cards .airport-code,
          #cards .mono,
          #cards [style*="monospace"] {
            font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace !important;
          }
          #cards img[src^="/static/"],
          #cards img[src^="http://"],
          #cards img[src^="https://"] {
            image-rendering: auto;
          }
          #cards .info-icon-svg,
          #cards .layover-icon-svg {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            flex: 0 0 auto;
          }
          #cards .currency-symbol {
            font-family: "Segoe UI Symbol", "Noto Sans", Arial, sans-serif !important;
          }
          #cards .expand-icon {
            display: none !important;
          }
        </style>
      `;
      return styleTags + '\n' + exportOverrides;
    }

    function inlineFlightAssetMarkup(html) {
      if (!html) return '';
      const timelinePlanePng = '<img class="timeline-plane-icon" src="/icons/timeline%20plane.png" alt="" loading="lazy" decoding="async" fetchpriority="low">';
      const expandedPlanePng = '<img src="/icons/expanded%20plane.png" alt="" loading="lazy" decoding="async" fetchpriority="low">';
      const watchPng = '<img src="/icons/watch.png" alt="" loading="lazy" decoding="async" fetchpriority="low">';
      const layoverPng = '<img src="/static/travel.png" alt="Airport" loading="lazy" decoding="async" fetchpriority="low">';

      return html
        .replace(/<img class="timeline-plane-icon"[^>]*>/g, timelinePlanePng)
        .replace(/<div class="info-icon">[^<]*<\/div>/g, (match) => {
          if (match.includes('âœˆ') || match.includes('✈') || match.includes('?')) return `<div class="info-icon">${expandedPlanePng}</div>`;
          if (match.includes('â ±') || match.includes('⏱') || match.includes('?')) return `<div class="info-icon">${watchPng}</div>`;
          return match;
        })
        .replace(/<img src="\/static\/travel\.png" alt="Airport">/g, layoverPng)
        .replace(/<div class="layover-pill"><span>[^<]*<\/span>/g, `<div class="layover-pill"><span class="layover-pill-icon">${watchPng}</span>`)
        .replace(/\u20B9/g, '<span class="currency-symbol">&#8377;</span>');
    }

    async function generateImageBlob(mode = 'current') {
      const payload = buildCardsImagePayload(mode);
      const requestKey = getCardsImageRequestKey(payload);
      const cachedBlob = cardsImageBlobCache.get(requestKey);
      if (cachedBlob) {
        return cachedBlob;
      }
      let blob = null;
      let clientError = null;

      if (useClientSideImageRender) {
        try {
          blob = await generateImageBlobClientSide(mode);
        } catch (error) {
          clientError = error;
          console.warn('Client-side image render failed, falling back to server render', error);
          useClientSideImageRender = false;
        }
      }

      if (!blob) {
        try {
          blob = await generateImageBlobServerSide(mode);
        } catch (serverError) {
          useClientSideImageRender = true;
          if (clientError) {
            throw new Error(`${clientError.message}. Fallback also failed: ${serverError.message}`);
          }
          throw serverError;
        }
      }

      cardsImageBlobCache.set(requestKey, blob);
      if (cardsImageBlobCache.size > 8) {
        const oldestKey = cardsImageBlobCache.keys().next().value;
        if (oldestKey) cardsImageBlobCache.delete(oldestKey);
      }
      return blob;
    }

    function getExpandedFlightIndices() {
      return Array.from(document.querySelectorAll('.flight-timeline-container'))
        .filter(node => node.style.display !== 'none')
        .map(node => Number(node.dataset.flightIndex))
        .filter(Number.isFinite);
    }

    function buildCardsImagePayload(mode = 'current') {
      const cardsContainer = document.getElementById('cards');
      const metrics = getCardsCaptureMetrics(cardsContainer);
      return {
        theme: document.documentElement.getAttribute('data-theme') || 'light',
        viewport_width: Math.max((metrics.width || 0) + 12, 320),
        cards_width: metrics.width,
        cards_height: metrics.height,
        cards_child_count: metrics.childCount,
        cards_html: createCardsSnapshotHtml(mode),
        expanded_indices: getExpandedFlightIndices()
      };
    }

    let imagePreloadTimer = null;
    let lastPreloadKey = '';
    let imagePreloadPromise = null;
    const cardsImageBlobCache = new Map();
    const prefersClientSideImageRender = true;
    let useClientSideImageRender = true;

    function getCardsImageRequestKey(payload) {
      return JSON.stringify([
        payload.theme,
        payload.cards_width,
        payload.cards_height,
        payload.viewport_width,
        payload.cards_html
      ]);
    }

    async function generateImageBlobServerSide(mode = 'current') {
      const payload = buildCardsImagePayload(mode);
      const response = await fetch('/api/render/cards-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        let errorMessage = 'Server-side image render failed';
        try {
          const data = await response.json();
          if (data && data.error) errorMessage = data.error;
        } catch (e) {
          // Ignore response parsing errors and keep the generic fallback message.
        }
        throw new Error(errorMessage);
      }

      return await response.blob();
    }

    async function generateImageBlobClientSide(mode = 'current') {
      if (typeof window.html2canvas !== 'function') {
        throw new Error('Client-side image renderer is unavailable');
      }

      if (mode === 'current') {
        const cardsContainer = document.getElementById('cards');
        const captureTarget = getCardsCaptureTarget(cardsContainer);
        if (!captureTarget) {
          throw new Error('No live card available for client render');
        }
        captureTarget.setAttribute('data-export-capture-target', 'true');
        try {
          if (document.fonts && document.fonts.ready) {
            await document.fonts.ready;
          }
          await new Promise((resolve) => requestAnimationFrame(resolve));
          await new Promise((resolve) => requestAnimationFrame(resolve));
          await new Promise((resolve) => setTimeout(resolve, 80));

          const rect = captureTarget.getBoundingClientRect();
          const captureWidth = Math.ceil(rect.width || captureTarget.offsetWidth || 1);
          const captureHeight = Math.ceil(rect.height || captureTarget.offsetHeight || 1);

          const canvas = await window.html2canvas(captureTarget, {
            backgroundColor: '#ffffff',
            scale: Math.max(2, Math.min(window.devicePixelRatio || 1, 3)),
            useCORS: true,
            logging: false,
            imageTimeout: 15000,
            width: captureWidth,
            height: captureHeight,
            windowWidth: Math.ceil(document.documentElement.clientWidth || window.innerWidth || captureWidth),
            windowHeight: Math.ceil(document.documentElement.clientHeight || window.innerHeight || captureHeight),
            scrollX: -window.scrollX,
            scrollY: -window.scrollY,
            onclone: (clonedDoc) => {
              const cloneBody = clonedDoc.body;
              const cloneHtml = clonedDoc.documentElement;
              if (cloneHtml) cloneHtml.style.background = '#ffffff';
              if (cloneBody) cloneBody.style.background = '#ffffff';
              [
                '.download-flight-overlay',
                '.loader-overlay',
                '.modal-overlay',
                '.sidebar-overlay',
                '.notification',
                '.toast',
                '#sidebar',
                '#sidebarOverlay',
                '#menuToggle',
                '#tsparticles'
              ].forEach((selector) => {
                clonedDoc.querySelectorAll(selector).forEach((node) => {
                  node.style.display = 'none';
                  node.style.visibility = 'hidden';
                });
              });
              clonedDoc.querySelectorAll('.expand-icon').forEach((node) => {
                node.style.display = 'none';
                node.style.visibility = 'hidden';
              });
              const clonedTarget = clonedDoc.querySelector('[data-export-capture-target="true"]');
              if (clonedTarget) {
                clonedTarget.style.margin = '0';
                clonedTarget.style.background = '#ffffff';
                clonedTarget.style.transform = 'none';
                clonedTarget.style.transition = 'none';
                clonedTarget.style.animation = 'none';
              }
              clonedDoc.querySelectorAll('.flight-timeline-container, .expand-icon, .cards-wrapper, .flight-card, .round-trip-card, .multi-city-card').forEach((node) => {
                node.style.transition = 'none';
                node.style.animation = 'none';
                node.style.transform = 'none';
              });
            }
          });

          const blob = await new Promise((resolve, reject) => {
            canvas.toBlob((result) => {
              if (result) resolve(result);
              else reject(new Error('Canvas export failed'));
            }, 'image/png');
          });

          return blob;
        } finally {
          captureTarget.removeAttribute('data-export-capture-target');
        }
      }

      const sandbox = document.createElement('div');
      sandbox.style.position = 'fixed';
      sandbox.style.left = '-20000px';
      sandbox.style.top = '0';
      sandbox.style.pointerEvents = 'none';
      sandbox.style.zIndex = '-1';
      sandbox.style.margin = '0';
      sandbox.style.padding = '0';
      sandbox.style.width = 'max-content';
      sandbox.style.height = 'max-content';
      sandbox.style.overflow = 'hidden';
      sandbox.style.background = '#ffffff';
      sandbox.setAttribute('data-theme', document.documentElement.getAttribute('data-theme') || 'light');

      const wrapper = document.createElement('div');
      wrapper.innerHTML = createCardsSnapshotHtml(mode);
      const snapshotCards = wrapper.firstElementChild;
      if (!snapshotCards) {
        throw new Error('No card snapshot available for client render');
      }
      const captureNode = snapshotCards.children.length === 1 ? snapshotCards.children[0] : snapshotCards;

      snapshotCards.style.margin = '0';
      snapshotCards.style.padding = '0';
      snapshotCards.style.width = 'fit-content';
      snapshotCards.style.maxWidth = 'none';
      snapshotCards.style.display = 'inline-grid';
      snapshotCards.style.justifyContent = 'start';
      snapshotCards.style.alignItems = 'start';
      snapshotCards.style.background = '#ffffff';
      snapshotCards.querySelectorAll('*').forEach((node) => {
        node.style.backdropFilter = 'none';
        node.style.webkitBackdropFilter = 'none';
      });
      sandbox.appendChild(snapshotCards);
      document.body.appendChild(sandbox);

      try {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        await new Promise((resolve) => requestAnimationFrame(resolve));
        if (document.fonts && document.fonts.ready) {
          await document.fonts.ready;
        }

        const childBounds = Array.from(captureNode.children || []).reduce((acc, node) => {
          const right = node.offsetLeft + node.offsetWidth;
          const bottom = node.offsetTop + node.offsetHeight;
          return {
            width: Math.max(acc.width, right),
            height: Math.max(acc.height, bottom)
          };
        }, { width: 0, height: 0 });
        const captureWidth = Math.ceil(childBounds.width || captureNode.scrollWidth || captureNode.offsetWidth || 1);
        const captureHeight = Math.ceil(childBounds.height || captureNode.scrollHeight || captureNode.offsetHeight || 1);

        const canvas = await window.html2canvas(captureNode, {
          backgroundColor: '#ffffff',
          scale: Math.max(2, Math.min(window.devicePixelRatio || 1, 3)),
          useCORS: true,
          logging: false,
          imageTimeout: 15000,
          width: captureWidth,
          height: captureHeight,
          windowWidth: captureWidth,
          windowHeight: captureHeight
        });

        const blob = await new Promise((resolve, reject) => {
          canvas.toBlob((result) => {
            if (result) resolve(result);
            else reject(new Error('Canvas export failed'));
          }, 'image/png');
        });

        return blob;
      } finally {
        sandbox.remove();
      }
    }

    async function writeImageBlobToClipboard(imageBlob) {
      if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
        throw new Error('Image clipboard is not supported in this browser');
      }
      await Promise.race([
        navigator.clipboard.write([
          new ClipboardItem({
            [imageBlob.type || 'image/png']: imageBlob
          })
        ]),
        new Promise((_, reject) => {
          window.setTimeout(() => reject(new Error('Clipboard write timed out')), 3500);
        })
      ]);
    }

    async function waitForCardImageReady(img, timeoutMs = 2500) {
      if (!img) return;
      if (img.complete) {
        if (img.naturalWidth > 0 && typeof img.decode === 'function') {
          await img.decode().catch(() => null);
        }
        return;
      }

      await new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve();
        };

        const timer = window.setTimeout(finish, timeoutMs);
        const cleanup = () => {
          window.clearTimeout(timer);
          img.removeEventListener('load', onDone);
          img.removeEventListener('error', onDone);
        };
        const onDone = () => {
          cleanup();
          finish();
        };

        img.addEventListener('load', onDone, { once: true });
        img.addEventListener('error', onDone, { once: true });
      });

      if (img.complete && img.naturalWidth > 0 && typeof img.decode === 'function') {
        await img.decode().catch(() => null);
      }
    }

    async function ensureCardsReadyForCapture() {
      const cardsContainer = document.getElementById('cards');
      if (!cardsContainer || !cardsContainer.children.length) {
        throw new Error('No flight cards available yet');
      }
      if (document.fonts && document.fonts.ready) {
        await document.fonts.ready;
      }
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const images = Array.from(cardsContainer.querySelectorAll('img'));
      await Promise.all(images.map(async (img) => {
        try {
          await waitForCardImageReady(img);
        } catch (e) {
          return null;
        }
      }));
      await new Promise((resolve) => setTimeout(resolve, 120));
    }

    function setCopyCardsButtonState(state = 'idle') {
      const button = document.getElementById('copyCardsImageBtn');
      if (!button) return;
      if (!button.dataset.defaultLabel) {
        button.dataset.defaultLabel = button.textContent.trim();
      }

      button.classList.remove('btn-copy-cards-success');

      if (state === 'loading') {
        button.disabled = true;
        button.textContent = 'Copying...';
        return;
      }

      button.disabled = false;

      if (state === 'success') {
        button.textContent = 'Copied!';
        void button.offsetWidth;
        button.classList.add('btn-copy-cards-success');
        window.clearTimeout(window.__copyCardsResetTimer);
        window.__copyCardsResetTimer = window.setTimeout(() => {
          setCopyCardsButtonState('idle');
        }, 1600);
        return;
      }

      button.textContent = button.dataset.defaultLabel;
    }

    async function copyCardsImage() {
      if (document.activeElement) document.activeElement.blur();
      setCopyCardsButtonState('loading');
      showNotification('Preparing image…', 'info', { id: 'copy-cards-status', duration: 7000 });
      let blob;
      try {
        await ensureCardsReadyForCapture();
        try {
          blob = await generateImageBlob('current');
        } catch (error) {
          console.warn('Image copy attempt 1 failed, retrying once', error);
          await ensureCardsReadyForCapture();
          blob = await generateImageBlob('current');
        }
        await writeImageBlobToClipboard(blob);
        setTimeout(() => submitItinerary(true), 0); // Fire-and-forget autosave
        setCopyCardsButtonState('success');
        showNotification('Cards image copied to clipboard!', 'success', { id: 'copy-cards-status', duration: 4000 });
      } catch (error) {
        console.error('Cards image copy failed', error);
        setCopyCardsButtonState('idle');
        if (blob) {
          downloadImage(blob);
          showNotification('Clipboard copy was blocked, so the cards image was downloaded instead.', 'warning', { id: 'copy-cards-status', duration: 5000 });
          return;
        }
        const message = error && error.message ? error.message : 'Failed to copy cards image';
        showNotification(message, 'error', { id: 'copy-cards-status', duration: 5000 });
      }
    }

    async function preloadCardsImage() {
      if (isRenderPreviewMode()) return;
      const payload = buildCardsImagePayload('current');
      const requestKey = getCardsImageRequestKey(payload);
      if (requestKey === lastPreloadKey && imagePreloadPromise) {
        return imagePreloadPromise;
      }

      lastPreloadKey = requestKey;
      imagePreloadPromise = (async () => {
        try {
          if (useClientSideImageRender && typeof window.html2canvas === 'function') {
            return;
          }
          await fetch('/api/render/cards-image/preload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
        } catch (error) {
          console.warn('Cards image preload failed', error);
        }
      })();

      return imagePreloadPromise;
    }

    function scheduleCardsImagePreload() {
      if (isRenderPreviewMode()) return;
      if (imagePreloadTimer) clearTimeout(imagePreloadTimer);
      imagePreloadTimer = setTimeout(() => {
        preloadCardsImage();
      }, 250);
    }


    async function shareCombined(type, btn) {
      if (document.activeElement) document.activeElement.blur();

      if (!currentFinalText) {
        showNotification('No itinerary generated yet', 'warning');
        return;
      }

      const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

      /* =====================================================
        EMAIL ONLY (TEXT, NO IMAGE)
      ===================================================== */
      if (type === 'email') {
        const plainText = currentFinalText.replace(/[*_]/g, '');

        try {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(plainText);
          } else {
            fallbackCopy(plainText, btn);
          }
          showNotification('Text copied for Email (no formatting)', 'success');
          animateButton(btn, 'Copied');
        } catch (e) {
          fallbackCopy(plainText, btn);
        }
        return;
      }

      showNotification('Generating image…', 'info');

      let waWindow = null;

      /* =====================================================
        DESKTOP WHATSAPP PRE-OPEN (POPUP SAFE)
      ===================================================== */
      if (type === 'whatsapp' && !isMobile) {
        waWindow = window.open('', '_blank');
        if (waWindow) {
          waWindow.document.write(`
              <html>
                <body style="font-family:sans-serif;text-align:center;margin-top:20%">
                  <h2>Generating itinerary…</h2>
                </body>
              </html>
            `);
        }
      }

      try {
        const imageBlob = await generateImageBlob();
        const filename = getFlightImageFilename();
        const file = new File([imageBlob], filename, {
          type: 'image/png'
        });

        /* =====================================================
          MOBILE → NATIVE SHARE (IMAGE + TEXT TOGETHER)
        ===================================================== */
        if (
          isMobile &&
          navigator.canShare &&
          navigator.canShare({ files: [file] })
        ) {
          await navigator.share({
            title: 'Flight Itinerary',
            text: currentFinalText, // Keep stars for WhatsApp formatting
            files: [file]
          });

          showNotification('Shared successfully!', 'success');
          return; // ⛔ STOP here on mobile
        }

        /* =====================================================
          DESKTOP WHATSAPP FALLBACK
        ===================================================== */
        if (type === 'whatsapp') {
          const encodedText = encodeURIComponent(currentFinalText);
          const waUrl = `https://web.whatsapp.com/send?text=${encodedText}`;

          try {
            // Try clipboard image copy
            const item = new ClipboardItem({ 'image/png': imageBlob });
            await navigator.clipboard.write([item]);
            showNotification('Image copied! Paste into WhatsApp (Ctrl+V)', 'success');
          } catch (e) {
            // Fallback: download image
            downloadImage(imageBlob);
            showNotification('Image downloaded. Attach manually.', 'warning');
          }

          if (waWindow) {
            waWindow.location.href = waUrl;
          } else {
            window.open(waUrl, '_blank');
          }
        }

      } catch (error) {
        console.error(error);
        showNotification('Sharing failed', 'error');
        if (waWindow) waWindow.close();
      }
    }

    /* =====================================================
      IMAGE DOWNLOAD HELPER
    ===================================================== */
    function getFlightImageFilename() {
      if (!currentFlights || currentFlights.length === 0) return 'Flight_Itinerary.png';

      // Use only flights from the first unit for the filename
      const firstUnitId = Object.keys(unitFlights)[0];
      const flightsInFirstUnit = unitFlights[firstUnitId] ? unitFlights[firstUnitId].length : 1;
      const optionFlights = currentFlights.slice(0, flightsInFirstUnit);

      const firstFlight = optionFlights[0];
      const dep = firstFlight.departure_airport || 'DEP';

      let typeStr = 'ONE WAY';
      let routeStr = `${dep} - ${firstFlight.arrival_airport || 'ARR'}`;

      if (currentTripType === 'round_trip') {
        typeStr = 'ROUND TRIP';
        routeStr = `${dep} - ${firstFlight.arrival_airport || 'ARR'}`;
      } else if (currentTripType === 'multi_city') {
        typeStr = 'MULTI CITY';
        const dests = [dep];
        optionFlights.forEach(f => {
          if (f.arrival_airport && f.arrival_airport !== dests[dests.length - 1]) {
            dests.push(f.arrival_airport);
          }
        });
        routeStr = dests.join(' - ');
      }

      // Ensure filename doesn't contain invalid characters
      const dateStr = (firstFlight.departure_date || '').replace(/[\/\\]/g, '-').trim() || 'DATE';
      let filename = `${routeStr} (${typeStr}) ${dateStr}.png`.replace(/[<>:"/\\|?*]/g, '_');

      // Limit length to avoid OS issues
      if (filename.length > 150) {
        filename = `${dep} (${typeStr}) ${dateStr}.png`;
      }

      return filename;
    }

    function downloadImage(blob, filename = null) {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || getFlightImageFilename();
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 100);
    }

    /* =====================================================
      LEGACY FUNCTIONS
    ===================================================== */
    function shareCardsAsImage() {
      shareCombined('whatsapp');
    }

    function launchDownloadFlightAnimation() {
      const sourceButton = document.querySelector('button[onclick="downloadCardsImage()"]');
      if (!sourceButton) {
        return {
          complete() { },
          cancel() { }
        };
      }

      const rect = sourceButton.getBoundingClientRect();
      const startX = rect.left + rect.width / 2;
      const startY = rect.top + rect.height / 2;
      const endX = Math.max(window.innerWidth - 54, startX + 40);
      const endY = 34;
      const loopDurationMs = 3800;
      const finishDurationMs = 1100;

      const overlay = document.createElement('div');
      overlay.className = 'download-flight-overlay';
      overlay.style.setProperty('--flight-start-x', `${startX}px`);
      overlay.style.setProperty('--flight-start-y', `${startY}px`);
      overlay.style.setProperty('--flight-end-x', `${endX}px`);
      overlay.style.setProperty('--flight-end-y', `${endY}px`);

      const plane = document.createElement('div');
      plane.className = 'download-flight';
      plane.innerHTML = '<img src="/icons/timeline%20plane.png" alt="">';
      overlay.appendChild(plane);
      document.body.appendChild(overlay);

      const rightX = window.innerWidth - 32;
      const leftX = 24;
      const rise = endY - startY;
      const pathPoints = [
        { x: startX, y: startY },
        { x: rightX, y: startY + rise * 0.18 },
        { x: leftX, y: startY + rise * 0.58 },
        { x: endX, y: endY }
      ];

      const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
      const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
      const catmullRom = (p0, p1, p2, p3, t) => {
        const t2 = t * t;
        const t3 = t2 * t;
        return {
          x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
          y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
        };
      };

      const catmullRomTangent = (p0, p1, p2, p3, t) => {
        const t2 = t * t;
        return {
          x: 0.5 * ((-p0.x + p2.x) + 2 * (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t + 3 * (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t2),
          y: 0.5 * ((-p0.y + p2.y) + 2 * (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t + 3 * (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t2)
        };
      };

      const getPathState = (progress) => {
        const p = easeInOutSine(progress);
        const segmentCount = pathPoints.length - 1;
        const scaled = p * segmentCount;
        const segmentIndex = Math.min(Math.floor(scaled), segmentCount - 1);
        const localT = clamp(scaled - segmentIndex, 0, 1);
        const p0 = pathPoints[Math.max(0, segmentIndex - 1)];
        const p1 = pathPoints[segmentIndex];
        const p2 = pathPoints[Math.min(pathPoints.length - 1, segmentIndex + 1)];
        const p3 = pathPoints[Math.min(pathPoints.length - 1, segmentIndex + 2)];
        const point = catmullRom(p0, p1, p2, p3, localT);
        const tangent = catmullRomTangent(p0, p1, p2, p3, localT);
        return { point, tangent };
      };

      const getLoopState = (elapsedMs) => {
        const cycleElapsed = elapsedMs % loopDurationMs;
        const cyclePhase = clamp(cycleElapsed / loopDurationMs, 0, 1);
        if (cyclePhase <= 0.5) {
          return {
            progress: cyclePhase * 2,
            direction: 1
          };
        }
        return {
          progress: (1 - cyclePhase) * 2,
          direction: -1
        };
      };

      let rafId = 0;
      let stopped = false;
      let finishRequested = false;
      let finishStartProgress = 0;
      let finishStartTime = 0;
      let completionShown = false;

      const showCompletionState = () => {
        if (completionShown || !overlay.isConnected) return;
        completionShown = true;
        const boom = document.createElement('div');
        boom.className = 'download-flight-boom';
        overlay.appendChild(boom);
        const label = document.createElement('div');
        label.className = 'download-flight-label';
        label.textContent = 'Downloaded';
        overlay.appendChild(label);
      };

      const teardown = (delayMs = 0) => {
        stopped = true;
        cancelAnimationFrame(rafId);
        if (delayMs > 0) {
          setTimeout(() => overlay.remove(), delayMs);
        } else {
          overlay.remove();
        }
      };

      const animationStart = performance.now();
      const animatePlane = (now) => {
        if (stopped) return;

        let progress;
        let finishingProgress = 0;
        let direction = 1;
        if (finishRequested) {
          finishingProgress = clamp((now - finishStartTime) / finishDurationMs, 0, 1);
          progress = finishStartProgress + ((1 - finishStartProgress) * easeInOutSine(finishingProgress));
        } else {
          const loopState = getLoopState(now - animationStart);
          progress = loopState.progress;
          direction = loopState.direction;
        }

        const { point, tangent } = getPathState(progress);
        const flightVector = {
          x: tangent.x * direction,
          y: tangent.y * direction
        };
        const facingLeft = flightVector.x < 0;
        const bankAngle = Math.atan2(flightVector.y, Math.max(Math.abs(flightVector.x), 0.001)) * (180 / Math.PI);
        const opacity = finishRequested
          ? clamp((1 - finishingProgress) / 0.18, 0, 1)
          : (progress < 0.06 ? progress / 0.06 : (progress > 0.94 ? (1 - progress) / 0.06 : 1));
        const scale = finishRequested
          ? 0.9
          : (progress < 0.2 ? 0.9 + progress * 0.35 : 0.97 - (progress * 0.18));

        plane.style.opacity = `${clamp(opacity, 0, 1)}`;
        plane.style.transform = `translate(-50%, -50%) translate3d(${point.x - startX}px, ${point.y - startY}px, 0) rotate(${bankAngle}deg) scale(${facingLeft ? -scale : scale}, ${scale})`;

        if (!finishRequested || finishingProgress < 1) {
          rafId = requestAnimationFrame(animatePlane);
        } else {
          plane.remove();
          showCompletionState();
          teardown(980);
        }
      };
      rafId = requestAnimationFrame(animatePlane);

      return {
        complete() {
          if (stopped || finishRequested) return;
          finishRequested = true;
          finishStartTime = performance.now();
          finishStartProgress = getLoopState(finishStartTime - animationStart).progress;
        },
        cancel() {
          if (stopped) return;
          teardown();
        }
      };
    }

    async function downloadCardsImage() {
      if (document.activeElement) document.activeElement.blur();
      const flightAnimation = launchDownloadFlightAnimation();
      showNotification('Preparing download…', 'info', { id: 'download-status', duration: 7000 });
      try {
        await ensureCardsReadyForCapture();
        let blob;
        try {
          blob = await generateImageBlob('current');
        } catch (error) {
          console.warn('Image download attempt 1 failed, retrying once', error);
          await ensureCardsReadyForCapture();
          blob = await generateImageBlob('current');
        }
        showNotification('Download ready…', 'info', { id: 'download-status', duration: 4000 });
        downloadImage(blob);
        flightAnimation.complete();
        showNotification('Image downloaded!', 'success', { id: 'download-status', duration: 4000 });
      } catch (e) {
        flightAnimation.cancel();
        const message = e && e.message ? e.message : 'Failed to generate image';
        showNotification(message, 'error', { id: 'download-status', duration: 5000 });
      }
    }
