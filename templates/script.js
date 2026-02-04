<script>
    let unitCount = 0;
    let flightCount = 0;
    let isParsing = false;
    let currentFlights = [];
    let currentFinalText = '';
    let currentMarkup = 0;
    let activeBillingType = 'passenger';
    let allCustomers = [];
    let currentTripType = 'one_way';
    let unitFlightCounts = {}; // Track flight count per unit for multi-city
    let unitFlights = {}; // Store flights organized by unit

    // Check authentication status on load
    window.addEventListener('DOMContentLoaded', async () => {
      await checkAuth();
      await loadCustomers();
      initializeTripType();
      initializeDarkMode();
    });

    // Dark mode functionality
    function initializeDarkMode() {
      const savedTheme = localStorage.getItem('theme') || 'light';
      const darkModeToggle = document.getElementById('darkModeToggle');

      // Apply saved theme
      document.documentElement.setAttribute('data-theme', savedTheme);
      updateDarkModeToggle(savedTheme);

      // Add click event listener
      darkModeToggle.addEventListener('click', toggleDarkMode);
    }

    function toggleDarkMode() {
      const currentTheme = document.documentElement.getAttribute('data-theme');
      const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

      document.documentElement.setAttribute('data-theme', newTheme);
      localStorage.setItem('theme', newTheme);
      updateDarkModeToggle(newTheme);
    }

    function updateDarkModeToggle(theme) {
      const darkModeToggle = document.getElementById('darkModeToggle');
      const icons = darkModeToggle.querySelectorAll('.dark-mode-icon');

      if (theme === 'dark') {
        icons[0].style.display = 'none';  // Moon icon
        icons[1].style.display = 'block'; // Sun icon
      } else {
        icons[0].style.display = 'block';  // Moon icon
        icons[1].style.display = 'none';  // Sun icon
      }
    }

    function initializeTripType() {
      const tripType = document.querySelector('input[name="tripType"]:checked').value;
      handleTripType();
    }

    async function checkAuth() {
      try {
        const response = await fetch('/api/user');
        if (response.ok) {
          const data = await response.json();
          updateAuthUI(data);
        }
      } catch (error) {
        // Not logged in, that's ok
      }
    }

    function updateAuthUI(user) {
      const authBtn = document.getElementById('authBtn');
      authBtn.textContent = `👤 ${user.username}`;
      authBtn.onclick = () => {
        if (confirm('Do you want to logout?')) {
          logout();
        }
      };
    }

    function handleAuthClick() {
      window.location.href = '/login';
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

    async function loadCustomers() {
      try {
        const response = await fetch('/api/customers');
        if (response.ok) {
          const data = await response.json();
          allCustomers = data.customers;
          populateCustomerSelects();
        }
      } catch (error) {
        // Not logged in or error loading customers
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

    function loadCustomerData(type) {
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

    function switchBillingTab(type) {
      activeBillingType = type;

      // Update tabs
      document.querySelectorAll('.billing-tab').forEach(tab => {
        tab.classList.remove('active');
      });
      event.target.classList.add('active');

      // Update forms
      document.getElementById('passengerForm').style.display = type === 'passenger' ? 'block' : 'none';
      document.getElementById('corporateForm').style.display = type === 'corporate' ? 'block' : 'none';
    }

    function openSaveModal() {
      // Check if we have parsed flights
      if (!currentFlights || currentFlights.length === 0) {
        showNotification('Please parse flights first', 'warning');
        return;
      }

      // Check if user is logged in
      fetch('/api/user')
        .then(response => {
          if (!response.ok) {
            showNotification('Please login to save itineraries', 'error');
            setTimeout(() => {
              window.location.href = '/login';
            }, 1500);
            return;
          }
          // User is logged in, show the modal
          document.getElementById('saveModal').style.display = 'flex';
        })
        .catch(error => {
          showNotification('Please login to save itineraries', 'error');
          setTimeout(() => {
            window.location.href = '/login';
          }, 1500);
        });
    }

    function closeSaveModal() {
      document.getElementById('saveModal').style.display = 'none';
      document.getElementById('saveForm').reset();
      clearForm('passenger');
      clearForm('corporate');
    }

    async function saveItinerary(event) {
      event.preventDefault();

      const saveBtnText = document.getElementById('saveBtnText');
      const saveBtnLoading = document.getElementById('saveBtnLoading');

      saveBtnText.style.display = 'none';
      saveBtnLoading.style.display = 'inline-block';

      try {
        // Gather billing data based on active tab
        let billingData = {
          billing_type: activeBillingType,
          flights: currentFlights,
          final_text: currentFinalText,
          markup: currentMarkup
        };

        if (activeBillingType === 'passenger') {
          billingData.bill_to_name = document.getElementById('passengerName').value;
          billingData.bill_to_email = document.getElementById('passengerEmail').value;
          billingData.bill_to_phone = document.getElementById('passengerPhone').value;
          billingData.bill_to_address = document.getElementById('passengerAddress').value;

          const customerId = document.getElementById('passengerCustomerSelect').value;
          if (customerId) {
            billingData.customer_id = customerId;
          }

          // If save to database is checked and no customer selected, create new customer
          if (document.getElementById('savePassengerToDb').checked && !customerId) {
            const customerData = {
              name: billingData.bill_to_name,
              email: billingData.bill_to_email,
              phone: billingData.bill_to_phone,
              address: billingData.bill_to_address,
              customer_type: 'passenger'
            };

            const customerResponse = await fetch('/api/customers', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(customerData)
            });

            if (customerResponse.ok) {
              const customerResult = await customerResponse.json();
              billingData.customer_id = customerResult.customer.id;
              await loadCustomers();
            }
          }
        } else {
          billingData.bill_to_name = document.getElementById('corporateName').value;
          billingData.bill_to_email = document.getElementById('corporateEmail').value;
          billingData.bill_to_phone = document.getElementById('corporatePhone').value;
          billingData.bill_to_address = document.getElementById('corporateAddress').value;
          billingData.bill_to_company = document.getElementById('corporateCompany').value;
          billingData.bill_to_gst = document.getElementById('corporateGst').value;

          const customerId = document.getElementById('corporateCustomerSelect').value;
          if (customerId) {
            billingData.customer_id = customerId;
          }

          // If save to database is checked and no customer selected, create new customer
          if (document.getElementById('saveCorporateToDb').checked && !customerId) {
            const customerData = {
              name: billingData.bill_to_name,
              email: billingData.bill_to_email,
              phone: billingData.bill_to_phone,
              address: billingData.bill_to_address,
              customer_type: 'corporate',
              company_name: billingData.bill_to_company,
              gst_number: billingData.bill_to_gst
            };

            const customerResponse = await fetch('/api/customers', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(customerData)
            });

            if (customerResponse.ok) {
              const customerResult = await customerResponse.json();
              billingData.customer_id = customerResult.customer.id;
              await loadCustomers();
            }
          }
        }

        // Save itinerary
        const response = await fetch('/api/itineraries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(billingData)
        });

        if (response.ok) {
          const result = await response.json();
          showNotification('Itinerary saved successfully!', 'success');
          closeSaveModal();

          // Optionally redirect to itineraries page
          setTimeout(() => {
            if (confirm('Would you like to view your saved itineraries?')) {
              window.location.href = '/itineraries';
            }
          }, 1000);
        } else {
          const error = await response.json();
          console.error('Save error response:', error);

          if (response.status === 401) {
            showNotification('Session expired. Please login again.', 'error');
            setTimeout(() => {
              window.location.href = '/login';
            }, 1500);
          } else {
            showNotification(error.error || 'Failed to save itinerary', 'error');
          }
        }
      } catch (error) {
        console.error('Save error:', error);
        showNotification('Failed to save itinerary. ' + error.message, 'error');
      } finally {
        saveBtnText.style.display = 'inline';
        saveBtnLoading.style.display = 'none';
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
    ${createFlightBox(flightId, 'Departure')}
    ${createSharedFareSection(unitId)}
  `;
    }

    function createRoundTripUnit(unitId) {
      const outboundId = ++flightCount;
      const returnId = ++flightCount;
      unitFlights[unitId] = [outboundId, returnId];

      return `
    ${unitId > 1 ? `<div class="flight-unit-header"><h3>Option ${unitId}</h3><button type="button" onclick="removeUnit(${unitId})">🗑️ Remove Option</button></div>` : ''}
    ${createFlightBox(outboundId, 'Outbound Flight')}
    ${createFlightBox(returnId, 'Return Flight')}
    ${createSharedFareSection(unitId)}
  `;
    }

    function createMultiCityUnit(unitId) {
      const flightId = ++flightCount;
      unitFlights[unitId] = [flightId];
      unitFlightCounts[unitId] = 1;

      return `
    <div class="flight-unit-header"><h3>Option ${unitId}</h3><button type="button" onclick="addCityToUnit(${unitId})">➕ Add City</button>${unitId > 1 ? `<button type="button" onclick="removeUnit(${unitId})">🗑️ Remove Option</button>` : ''}</div>
    <div id="unit-${unitId}-flights" style="display: contents;">
      ${createFlightBox(flightId, `City 1`)}
    </div>
    ${createSharedFareSection(unitId)}
  `;
    }

    function createFlightBox(flightId, label) {
      return `
    <div class="flight-block" data-flight-id="${flightId}">
      <div class="flight-header">
        <span class="flight-number">${label}</span>
        <label style="display:flex; align-items:center; gap:0.5rem; cursor:pointer; font-size: 0.85rem;">
            <input type="checkbox" class="layover-checkbox">
            <span>Has Layover</span>
        </label>
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

The price will be automatically extracted as Saver Fare"></textarea>
      </div>
    </div>
  `;
    }

    function createSharedFareSection(unitId) {
      return `
    <div class="shared-fare-section" data-unit-id="${unitId}">
      <h4>📊 Shared Fares for Unit ${unitId}</h4>
      <div class="fare-types">
        <div class="fare-group">
          <div class="fare-checkbox">
            <input type="checkbox" id="saver-unit-${unitId}" onchange="toggleUnitFare(this, 'saver', ${unitId})" checked>
            <label for="saver-unit-${unitId}">Saver Fare (auto-extracted or manual)</label>
          </div>
          <input type="number" class="fare-input fare-saver-unit-${unitId}" placeholder="Auto-filled from text or enter manually" min="0">
        </div>

        <div class="fare-group">
          <div class="fare-checkbox">
            <input type="checkbox" id="corporate-unit-${unitId}" onchange="toggleUnitFare(this, 'corporate', ${unitId})">
            <label for="corporate-unit-${unitId}">Corporate Fare</label>
          </div>
          <input type="number" class="fare-input fare-corporate-unit-${unitId}" placeholder="₹ 0" min="0" disabled>
        </div>

        <div class="fare-group">
          <div class="fare-checkbox">
            <input type="checkbox" id="sme-unit-${unitId}" onchange="toggleUnitFare(this, 'sme', ${unitId})">
            <label for="sme-unit-${unitId}">SME Fare</label>
          </div>
          <input type="number" class="fare-input fare-sme-unit-${unitId}" placeholder="₹ 0" min="0" disabled>
        </div>
      </div>
    </div>
  `;
    }

    function initializeUnitFares(unitId) {
      // Can add initialization logic here if needed
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

    function removeUnit(unitId) {
      if (unitCount <= 1) {
        showNotification('You must have at least one option', 'warning');
        return;
      }

      const unit = document.querySelector(`[data-unit-id="${unitId}"]`).closest('.flight-unit');
      unit.remove();
      unitCount--;

      // Cleanup
      if (unitFlights[unitId]) {
        delete unitFlights[unitId];
      }
      if (unitFlightCounts[unitId]) {
        delete unitFlightCounts[unitId];
      }
    }

    function toggleUnitFare(checkbox, fareType, unitId) {
      const input = document.querySelector(`.fare-${fareType}-unit-${unitId}`);
      input.disabled = !checkbox.checked;
      if (!checkbox.checked) {
        input.value = '';
      }
    }

    function showNotification(message, type = 'success') {
      const notification = document.createElement('div');
      notification.className = `notification ${type}`;
      notification.innerHTML = `
    <span>${type === 'error' ? '❌' : type === 'warning' ? '⚠️' : '✅'}</span>
    <span>${message}</span>
  `;
      document.body.appendChild(notification);

      setTimeout(() => {
        notification.style.animation = 'slideIn 0.3s ease reverse';
        setTimeout(() => notification.remove(), 300);
      }, 3000);
    }

    async function parseFlights() {
      if (isParsing) {
        showNotification('Parsing already in progress', 'warning');
        return;
      }

      const markup = document.getElementById("markup").value.trim();

      // Validation - markup is optional, default to 0 if not entered
      const markupValue = markup === '' ? 0 : Number(markup);
      if (Number.isNaN(markupValue) || markupValue < 0) {
        showNotification('Please enter a valid markup amount', 'error');
        document.getElementById("markup").focus();
        return;
      }

      currentMarkup = markupValue;

      let hasError = false;
      const flights = [];
      const flightTexturesByUnit = {}; // Map unit IDs to their flight texts and fares

      // Process each unit
      Object.entries(unitFlights).forEach(([unitId, flightIds]) => {
        const unitFares = {};

        // Get shared fares for this unit
        ['saver', 'corporate', 'sme'].forEach(fareType => {
          const checkbox = document.getElementById(`${fareType}-unit-${unitId}`);
          const input = document.querySelector(`.fare-${fareType}-unit-${unitId}`);

          if (checkbox && checkbox.checked) {
            if (fareType === 'saver') {
              // For saver fare, value is optional - parser will try to extract from text
              if (input && input.value && input.value.trim() !== '') {
                unitFares[fareType] = Number(input.value);
              }
              // If empty, don't add to unitFares - let parser extract it
            } else {
              // For corporate and SME, always require manual entry
              if (!input || !input.value || input.value.trim() === '' || Number(input.value) < 0) {
                showNotification(`Please enter ${fareType.charAt(0).toUpperCase() + fareType.slice(1)} Fare for Option ${unitId}`, 'error');
                if (input) input.focus();
                hasError = true;
              } else {
                unitFares[fareType] = Number(input.value);
              }
            }
          }
        });

        // For saver, allow if checkbox is checked (even if empty) because parser will extract
        const saverCheckbox = document.getElementById(`saver-unit-${unitId}`);
        if (!saverCheckbox || !saverCheckbox.checked) {
          // If saver not checked AND no other fares, error
          if (Object.keys(unitFares).length === 0) {
            showNotification(`Please select at least one fare type for Option ${unitId}`, 'error');
            hasError = true;
          }
        }

        // Collect flight texts for this unit
        let unitFlightTexts = [];
        flightIds.forEach((flightId) => {
          const block = document.querySelector(`[data-flight-id="${flightId}"]`);
          if (block) {
            const text = block.querySelector("textarea").value.trim();
            const hasLayover = block.querySelector(".layover-checkbox")?.checked || false;
            if (text) {
              unitFlightTexts.push(text);
              flights.push({ text: text, fares: unitFares, has_layover: hasLayover });
            }
          }
        });

        if (unitFlightTexts.length === 0) {
          showNotification(`Please paste at least one flight detail for Option ${unitId}`, 'error');
          hasError = true;
        }

        flightTexturesByUnit[unitId] = unitFlightTexts;
      });

      if (hasError || flights.length === 0) {
        return;
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

      try {
        // Send flight texts and their selected fares
        // If saver is checked but empty, parser will try to extract it from text
        const response = await fetch("/parse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            flights: flights.map(f => f.text),
            fares: flights.map(f => f.fares), // Send user-selected fares for each flight
            layover_flags: flights.map(f => f.has_layover),
            markup: Number(markup)
          })
        });

        const data = await response.json();

        if (!response.ok) {
          showNotification(data.error || 'Failed to parse flights', 'error');
          return;
        }

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

        currentFlights = data.flights;
        renderResults(data.flights);
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

    function renderResults(flights) {
      if (!flights || flights.length === 0) {
        return;
      }

      // Show sections
      document.getElementById("cardsSection").style.display = 'block';
      document.getElementById("outputSection").style.display = 'block';

      // Render cards with unit grouping
      const cardsContainer = document.getElementById("cards");
      cardsContainer.innerHTML = '';

      // Group flights by unit for display
      let flightIndex = 0;
      Object.entries(unitFlights).forEach(([unitId, flightIds]) => {
        if (currentTripType === 'round_trip' || currentTripType === 'multi_city') {
          // Create a unit container with side-by-side layout
          const unitContainer = document.createElement('div');
          unitContainer.style.marginBottom = '2rem';
          unitContainer.style.width = '100%';
          unitContainer.style.boxSizing = 'border-box';

          // Create header
          const unitHeader = document.createElement('h4');
          unitHeader.style.marginBottom = '1rem';
          unitHeader.style.color = 'var(--primary)';
          unitHeader.style.paddingBottom = '0.5rem';
          unitHeader.style.borderBottom = '2px solid var(--primary)';

          if (currentTripType === 'round_trip') {
            unitHeader.textContent = `Round Trip Option ${unitId}`;
          } else if (currentTripType === 'multi_city') {
            unitHeader.textContent = `Multi-City Option ${unitId}`;
          }
          unitContainer.appendChild(unitHeader);

          // Create flex container for side-by-side cards
          const cardsWrapper = document.createElement('div');
          cardsWrapper.className = 'cards-wrapper';

          flightIds.forEach((flightId) => {
            if (flightIndex < flights.length) {
              const flight = flights[flightIndex];
              const card = createFlightCard(flight, flightIndex);
              cardsWrapper.appendChild(card);
              flightIndex++;
            }
          });

          unitContainer.appendChild(cardsWrapper);
          cardsContainer.appendChild(unitContainer);
        } else {
          // One Way - no grouping needed
          if (flightIndex < flights.length) {
            const flight = flights[flightIndex];
            const card = createFlightCard(flight, flightIndex);
            cardsContainer.appendChild(card);
            flightIndex++;
          }
        }
      });

      // Render output text with trip type awareness
      let output = '';
      const tripTypeLabel = currentTripType === 'one_way' ? 'One Way Air Travel' :
        currentTripType === 'round_trip' ? 'Round Trip Air Travel' :
          'Multi-City Air Travel';

      output = `Your Flight Itinerary for ${tripTypeLabel} for 1 Traveller(s):\n\n`;

      if (currentTripType === 'round_trip') {
        // Organize round trip flights by outbound and return
        let flightIdx = 0;
        Object.entries(unitFlights).forEach(([unitId, flightIds]) => {
          if (flightIds.length === 2) {
            output += `\n${'='.repeat(60)}\n`;
            output += `ROUND TRIP OPTION ${unitId}\n`;
            output += `${'='.repeat(60)}\n\n`;

            // Outbound flight
            output += `*✈️ OUTBOUND FLIGHT*\n`;
            const outboundFlight = flights[flightIdx];
            output += formatFlightOutputWithoutFares(outboundFlight, flightIdx + 1);

            // Return flight
            output += `\n*✈️ RETURN FLIGHT*\n`;
            const returnFlight = flights[flightIdx + 1];
            output += formatFlightOutputWithoutFares(returnFlight, 2);

            // Show fares once for the option
            output += `\n*FARES FOR THIS OPTION:*\n`;
            output += formatFaresOutput(outboundFlight);

            flightIdx += 2;
          }
        });
      } else if (currentTripType === 'multi_city') {
        // Organize multi-city flights by option
        let flightIdx = 0;
        Object.entries(unitFlights).forEach(([unitId, flightIds]) => {
          output += `\n${'='.repeat(60)}\n`;
          output += `MULTI-CITY OPTION ${unitId}\n`;
          output += `${'='.repeat(60)}\n\n`;

          flightIds.forEach((fid, cityIdx) => {
            if (flightIdx < flights.length) {
              output += `*✈️ CITY ${cityIdx + 1}*\n`;
              const flight = flights[flightIdx];
              output += formatFlightOutputWithoutFares(flight, cityIdx + 1);
              output += '\n';
              flightIdx++;
            }
          });

          // Show fares once for the option
          if (flightIdx > 0) {
            output += `\n*FARES FOR THIS OPTION:*\n`;
            output += formatFaresOutput(flights[flightIdx - 1]);
          }
        });
      } else {
        // One Way - simple list
        flights.forEach((flight, index) => {
          output += formatFlightOutput(flight, index + 1);
          if (index < flights.length - 1) {
            output += '\n';
          }
        });
      }

      output += `\n\nPlease confirm the same at the earliest. 

Contact: +919831020012
Email: mail@timetours.in

Thanks,
Time Travels

*Note:* Airline ticket pricing is dynamic. Fares are valid as of now and might change at the time of issuance.`;

      currentFinalText = output.trim();
      document.getElementById("output").textContent = currentFinalText;

      // Scroll to results
      document.getElementById("cardsSection").scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function createFlightCard(flight, index) {
      const card = document.createElement('div');
      card.className = 'flight-card';
      card.setAttribute('data-flight-index', index);

      const isMissingDate = !flight.departure_date || flight.departure_date === 'N/A';
      const dateDisplay = isMissingDate ? 'Date Required' : flight.departure_date;

      // Calculate derived info
      const hasSegments = flight.segments && flight.segments.length > 0;
      const displayStops = flight.stops || (hasSegments ? `${flight.segments.length - 1} Stop(s)` : 'Direct');
      const isDirect = displayStops.toLowerCase().includes('non-stop') || displayStops.toLowerCase().includes('direct') || (flight.segments && flight.segments.length <= 1);

      // --- Date Header (if missing) ---
      let dateHeaderHTML = '';
      if (isMissingDate) {
        dateHeaderHTML = `
            <div class="date-warning-strip" id="date-warning-${index}">
                <span>⚠️ ${dateDisplay}</span>
                <button class="date-btn" onclick="promptDateInput(${index})">Select Date</button>
            </div>
        `;
      }

      // Helper for city display
      const formatCity = (city, airport) => {
        if (!city) return airport || '';
        // If city already contains airport code (e.g. "Mumbai (BOM)"), don't add it again
        if (airport && city.includes(airport)) return city;
        // If city is just the airport code, don't repeat
        if (airport && city.trim() === airport.trim()) return city;

        return `${city} <span class="airport-code-small">(${airport || ''})</span>`;
      };

      // Helper for layover calculation
      const calculateLayover = (arrivalTime, departureTime) => {
        if (!arrivalTime || !departureTime) return null;

        try {
          // Parse "HH:MM" or "H:MM" - simplistic parser assuming 24h format as per typical flight data
          // If AM/PM is present, handling would be more complex, but let's assume standard format first
          // or try to handle AM/PM if detected

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

          const startMins = parseTime(arrivalTime);
          const endMins = parseTime(departureTime);

          if (startMins === null || endMins === null) return null;

          let diff = endMins - startMins;
          if (diff < 0) diff += 24 * 60; // Next day

          const hours = Math.floor(diff / 60);
          const minutes = diff % 60;

          let text = '';
          if (hours > 0) text += `${hours}h `;
          if (minutes > 0) text += `${minutes}m`;

          // Determine label
          let label = 'Layover';
          let alertClass = ''; // Default neutral

          if (diff < 60) { // < 1 hour
            label = 'Short Layover';
            alertClass = 'short';
          } else if (diff > 300) { // > 5 hours
            label = 'Long Wait';
            alertClass = 'long';
          }

          return { text: text.trim(), label, alertClass };
        } catch (e) {
          return null;
        }
      };

      // --- Summary Header ---
      const summaryHTML = `
        <div class="flight-summary">
            <div class="summary-main">
                <div class="summary-airline">
                    <div class="airline-name">${flight.airline}</div>
                    <div class="flight-code">${flight.flight_number}</div>
                    <!-- IMPORTANT: Added ID for date display update -->
                    <div id="date-display-${index}" style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 0.25rem;">${isMissingDate ? '' : flight.departure_date}</div>
                </div>
                
                <div class="flight-route-visual">
                    <div class="time-group">
                        <div class="time-big">${flight.departure_time}</div>
                        <div class="city-code">${flight.departure_city}</div>
                    </div>
                    
                    <div class="duration-line-container">
                        <div class="duration-text">${flight.duration}</div>
                        <div class="route-line"></div>
                        <div class="stops-text ${isDirect ? 'direct' : ''}">${displayStops}</div>
                    </div>
                    
                    <div class="time-group">
                        <div class="time-big">${flight.arrival_time}</div>
                        <div class="city-code">${flight.arrival_city}</div>
                    </div>
                </div>
            </div>
        </div>
      `;

      // --- Timeline Content ---
      let timelineHTML = '<div class="flight-timeline">';

      if (hasSegments && !isDirect) {
        // Connecting Flight Timeline
        flight.segments.forEach((seg, i) => {
          // Calculate if there is a next segment for layover
          const nextSeg = flight.segments[i + 1];

          // Segment Departure
          timelineHTML += `
                <div class="timeline-segment">
                    <div class="t-dot departure"></div>
                    <div class="t-time-row">
                        <div class="t-time">${seg.departure_time || ''}</div>
                        <div class="t-city">${formatCity(seg.departure_city || seg.departure_airport || 'Departure', seg.departure_airport)}</div>
                    </div>
                    
                    <!-- Flight Info Box -->
                    <div class="flight-info-block">
                        <div class="info-row">
                             <div class="info-icon">✈</div>
                             <span style="font-weight: 600; color: var(--text-primary);">${seg.airline || flight.airline} ${seg.flight_number || ''}</span>
                        </div>
                        <div class="info-row">
                             <div class="info-icon">⏱</div>
                             <span>${seg.duration || 'Duration n/a'}</span>
                             <span>•</span>
                             <span>${flight.baggage || 'Baggage n/a'}</span>
                        </div>
                    </div>

                    <div class="t-time-row">
                        <div class="t-time" style="color: var(--text-secondary); font-size: 1rem;">${seg.arrival_time || ''}</div>
                        <div class="t-city" style="font-weight: 500; color: var(--text-secondary); font-size: 0.95rem;">${formatCity(seg.arrival_city || seg.arrival_airport || 'Arrival', seg.arrival_airport)}</div>
                    </div>
                </div>
             `;

          // Layover Block
          if (nextSeg) {
            const layoverInfo = calculateLayover(seg.arrival_time, nextSeg.departure_time);
            const durationText = layoverInfo ? layoverInfo.text : '';
            const labelText = layoverInfo ? layoverInfo.label : 'Connect in airport';

            timelineHTML += `
                    <div class="layover-container">
                        <div class="layover-line-fix"></div>
                        <div class="layover-pill">
                            <span>⏱</span>
                            <span>${labelText} • ${durationText}</span> 
                        </div>
                    </div>
                 `;
          }
        });

      } else {
        // Direct Flight Timeline (Simple start and end)
        timelineHTML += `
            <div class="timeline-segment">
                <div class="t-dot departure"></div>
                <div class="t-time-row">
                    <div class="t-time">${flight.departure_time}</div>
                    <div class="t-city">${formatCity(flight.departure_city, flight.departure_airport)}</div>
                </div>
                
                <div class="flight-info-block">
                    <div class="info-row">
                         <div class="info-icon">✈</div>
                         <span style="font-weight: 600; color: var(--text-primary);">${flight.airline} ${flight.flight_number}</span>
                    </div>
                    <div class="info-row">
                         <div class="info-icon">⏱</div>
                         <span>${flight.duration}</span>
                    </div>
                     <div class="info-row">
                         <div class="info-icon">🧳</div>
                         <span>${flight.baggage}</span>
                         <span>•</span>
                         <span>${flight.refundability || 'Refundable'}</span>
                    </div>
                </div>

                <div class="t-dot arrival"></div>
                <div class="t-time-row">
                    <div class="t-time">${flight.arrival_time}</div>
                    <div class="t-city">${formatCity(flight.arrival_city, flight.arrival_airport)}</div>
                </div>
            </div>
        `;
      }

      timelineHTML += '</div>'; // End timeline

      // --- Fares Footer ---
      let faresHTML = '<div class="card-footer-fares">';
      Object.entries(flight.fares).forEach(([type, base]) => {
        const finalFare = base + (flight.markup || 0);
        faresHTML += `
          <div class="footer-fare-item">
            <span class="footer-fare-label">${type}</span>
            <span class="footer-fare-price">₹ ${finalFare.toLocaleString('en-IN')}</span>
          </div>
        `;
      });
      faresHTML += '</div>';

      card.innerHTML = dateHeaderHTML + summaryHTML + timelineHTML + faresHTML;
      return card;
    }

    // createSegmentsHTML is no longer used separately, integrated into createFlightCard
    function createSegmentsHTML(flight) { return ''; }

    function formatFlightOutput(flight, flightNumber) {
      let fareLines = '';
      Object.entries(flight.fares).forEach(([type, base]) => {
        const finalFare = base + flight.markup;
        fareLines += `*${type.charAt(0).toUpperCase() + type.slice(1)} Fare:* ₹ ${finalFare.toLocaleString('en-IN')}\n`;
      });

      const dateDisplay = !flight.departure_date || flight.departure_date === 'N/A' ? '[DATE TO BE CONFIRMED]' : flight.departure_date;

      return `*${flightNumber}. ${flight.airline} : ${flight.flight_number}*

*Date:* ${dateDisplay}
*Departure:* ${flight.departure_city} (${flight.departure_airport})
*Time:* ${flight.departure_time}

*Arrival:* ${flight.arrival_city} (${flight.arrival_airport})
*Time:* ${flight.arrival_time}

*Duration:* ${flight.duration} (${flight.stops})

*Baggage:* ${flight.baggage}
*${flight.refundability}*

${fareLines}`;
    }

    function formatFlightOutputWithoutFares(flight, flightNumber) {
      const dateDisplay = !flight.departure_date || flight.departure_date === 'N/A' ? '[DATE TO BE CONFIRMED]' : flight.departure_date;

      return `*${flightNumber}. ${flight.airline} : ${flight.flight_number}*

*Date:* ${dateDisplay}
*Departure:* ${flight.departure_city} (${flight.departure_airport})
*Time:* ${flight.departure_time}

*Arrival:* ${flight.arrival_city} (${flight.arrival_airport})
*Time:* ${flight.arrival_time}

*Duration:* ${flight.duration} (${flight.stops})

*Baggage:* ${flight.baggage}
*${flight.refundability}*`;
    }

    function formatFaresOutput(flight) {
      let fareLines = '';
      Object.entries(flight.fares).forEach(([type, base]) => {
        const finalFare = base + flight.markup;
        fareLines += `*${type.charAt(0).toUpperCase() + type.slice(1)} Fare:* ₹ ${finalFare.toLocaleString('en-IN')}\n`;
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

    function regenerateOutputText() {
      if (!currentFlights || currentFlights.length === 0) {
        console.log('No current flights available');
        return;
      }

      let output = '';
      const tripTypeLabel = currentTripType === 'one_way' ? 'One Way Air Travel' :
        currentTripType === 'round_trip' ? 'Round Trip Air Travel' :
          'Multi-City Air Travel';

      output = `Your Flight Itinerary for ${tripTypeLabel} for 1 Traveller(s):\n\n`;

      if (currentTripType === 'round_trip') {
        let flightIdx = 0;
        Object.entries(unitFlights).forEach(([unitId, flightIds]) => {
          if (flightIds.length === 2) {
            output += `\n${'='.repeat(60)}\n`;
            output += `ROUND TRIP OPTION ${unitId}\n`;
            output += `${'='.repeat(60)}\n\n`;

            output += `*✈️ OUTBOUND FLIGHT*\n`;
            const outboundFlight = currentFlights[flightIdx];
            output += formatFlightOutputWithoutFares(outboundFlight, flightIdx + 1);

            output += `\n*✈️ RETURN FLIGHT*\n`;
            const returnFlight = currentFlights[flightIdx + 1];
            output += formatFlightOutputWithoutFares(returnFlight, 2);

            output += `\n*FARES FOR THIS OPTION:*\n`;
            output += formatFaresOutput(outboundFlight);

            flightIdx += 2;
          }
        });
      } else if (currentTripType === 'multi_city') {
        let flightIdx = 0;
        Object.entries(unitFlights).forEach(([unitId, flightIds]) => {
          output += `\n${'='.repeat(60)}\n`;
          output += `MULTI-CITY OPTION ${unitId}\n`;
          output += `${'='.repeat(60)}\n\n`;

          flightIds.forEach((fid, cityIdx) => {
            if (flightIdx < currentFlights.length) {
              output += `*✈️ CITY ${cityIdx + 1}*\n`;
              const flight = currentFlights[flightIdx];
              output += formatFlightOutputWithoutFares(flight, cityIdx + 1);
              output += '\n';
              flightIdx++;
            }
          });

          if (flightIdx > 0) {
            output += `\n*FARES FOR THIS OPTION:*\n`;
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

      output += `\n\nPlease confirm the same at the earliest. 

Contact: +919831020012
Email: mail@timetours.in

Thanks,
Time Travels

*Note:* Airline ticket pricing is dynamic. Fares are valid as of now and might change at the time of issuance.`;

      currentFinalText = output.trim();
      const outputElement = document.getElementById("output");
      if (outputElement) {
        outputElement.textContent = currentFinalText;
        console.log('Output text updated');
      } else {
        console.log('Output element not found');
      }
    }

    function saveDateInput(flightIndex) {
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
        const oldDate = currentFlights[flightIndex].departure_date;
        console.log('Old date:', oldDate, 'New date:', formattedDate);

        currentFlights[flightIndex].departure_date = formattedDate;

        // Update the card display
        const dateDisplay = document.getElementById(`date-display-${flightIndex}`);
        if (dateDisplay) {
          dateDisplay.innerHTML = formattedDate;
          dateDisplay.style.color = 'var(--primary)';
        }

        // Remove the "Enter Date" warning strip if it exists
        const warningStrip = document.getElementById(`date-warning-${flightIndex}`);
        if (warningStrip) {
          warningStrip.remove();
        }

        // Update the output text by replacing the old date with new date
        // If old date was "N/A" or missing, we can't do a replace - we must regenerate
        if (currentFinalText && oldDate && oldDate !== 'N/A' && oldDate.length > 5) {
          const updatedOutput = currentFinalText.replace(new RegExp(oldDate, 'g'), formattedDate);
          currentFinalText = updatedOutput;
          const outputElement = document.getElementById("output");
          if (outputElement) {
            outputElement.textContent = currentFinalText;
          }
        } else {
          // Fallback: regenerate full output
          regenerateOutputText();
        }

        showNotification(`Date set to ${formattedDate}`, 'success');
      } else {
        console.log('currentFlights not available or index out of range');
        showNotification('Error updating flight', 'error');
      }

      closeDateModal();
    }

    function copyOutput() {
      const output = document.getElementById("output").textContent;
      navigator.clipboard.writeText(output).then(() => {
        showNotification('Copied to clipboard!', 'success');
      }).catch(() => {
        showNotification('Failed to copy', 'error');
      });
    }

    function shareOnWhatsApp() {
      const output = document.getElementById("output").textContent;
      const encodedText = encodeURIComponent(output);
      const whatsappUrl = `https://wa.me/?text=${encodedText}`;
      window.open(whatsappUrl, '_blank');
    }

    function shareCardsAsImage() {
      showNotification('Generating image... This may take a moment', 'warning');

      const cardsContainer = document.getElementById('cards');

      if (typeof html2canvas === 'undefined') {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
        script.onload = () => captureAndShare();
        document.head.appendChild(script);
      } else {
        captureAndShare();
      }
    }

    function captureAndShare() {
      const cardsContainer = document.getElementById('cards');

      html2canvas(cardsContainer, {
        backgroundColor: '#f8fafc',
        scale: 2,
        logging: false,
        useCORS: true
      }).then(canvas => {
        canvas.toBlob(blob => {
          const file = new File([blob], 'flight-cards.png', { type: 'image/png' });

          if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
            navigator.share({
              files: [file],
              title: 'Flight Itinerary Cards',
              text: 'Check out these flight options!'
            }).then(() => {
              showNotification('Shared successfully!', 'success');
            }).catch((error) => {
              if (error.name !== 'AbortError') {
                shareToWhatsAppWeb(blob);
              }
            });
          } else {
            shareToWhatsAppWeb(blob);
          }
        }, 'image/png');
      }).catch((error) => {
        showNotification('Failed to generate image', 'error');
        console.error('Screenshot error:', error);
      });
    }

    function shareToWhatsAppWeb(blob) {
      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

      if (isMobile) {
        downloadImageWithInstructions(blob);
      } else {
        downloadImageWithInstructions(blob);
      }
    }

    function downloadImageWithInstructions(blob) {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `flight-cards-${Date.now()}.png`;
      link.click();
      URL.revokeObjectURL(url);

      const helperText = "Flight options attached 👆\n\nPlease let me know which option works best for you!";
      navigator.clipboard.writeText(helperText).catch(() => { });

      showWhatsAppInstructions();
    }

    function showWhatsAppInstructions() {
      const modal = document.createElement('div');
      modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    animation: fadeIn 0.3s ease;
  `;

      const modalContent = document.createElement('div');
      modalContent.style.cssText = `
    background: white;
    border-radius: 16px;
    padding: 2rem;
    max-width: 500px;
    margin: 1rem;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    animation: slideUp 0.3s ease;
  `;

      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

      modalContent.innerHTML = `
    <style>
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes slideUp {
        from { transform: translateY(50px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
    </style>
    <div style="text-align: center;">
      <div style="font-size: 3rem; margin-bottom: 1rem;">✅</div>
      <h2 style="margin-bottom: 1rem; color: #0f172a;">Image Downloaded!</h2>
      <p style="color: #64748b; margin-bottom: 0.5rem; line-height: 1.6;">
        ${isMobile ?
          'The flight cards image has been saved to your device.' :
          'The flight cards image has been downloaded to your computer.'}
      </p>
      <p style="color: #10b981; margin-bottom: 1.5rem; font-weight: 500; font-size: 0.9rem;">
        📋 Message copied to clipboard!
      </p>
      
      <div style="background: #f8fafc; border-radius: 12px; padding: 1.5rem; margin-bottom: 1.5rem; text-align: left;">
        <h3 style="font-size: 0.9rem; color: #0f172a; margin-bottom: 1rem; font-weight: 600;">📱 To Share on WhatsApp:</h3>
        <ol style="color: #475569; line-height: 1.8; padding-left: 1.2rem; margin: 0;">
          <li>Open WhatsApp</li>
          <li>Select the contact or group</li>
          <li>Click the attachment (📎) icon</li>
          <li>Choose "Gallery" or "Photos"</li>
          <li>Select the downloaded image</li>
          <li>Paste the copied message (optional)</li>
          <li>Send! 🚀</li>
        </ol>
      </div>
      
      <button onclick="this.parentElement.parentElement.parentElement.remove()" 
        style="background: linear-gradient(135deg, #2563eb, #0ea5e9); color: white; border: none; padding: 0.875rem 2rem; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; width: 100%; transition: transform 0.2s ease;">
        Got It!
      </button>
      
      <button onclick="openWhatsAppDirect(); this.parentElement.parentElement.parentElement.remove();" 
        style="background: #25D366; color: white; border: none; padding: 0.875rem 2rem; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; width: 100%; margin-top: 0.5rem; transition: transform 0.2s ease;">
        📱 Open WhatsApp Now
      </button>
    </div>
  `;

      modal.appendChild(modalContent);
      document.body.appendChild(modal);

      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.remove();
        }
      });

      const buttons = modalContent.querySelectorAll('button');
      buttons.forEach(btn => {
        btn.addEventListener('mouseenter', () => {
          btn.style.transform = 'translateY(-2px)';
        });
        btn.addEventListener('mouseleave', () => {
          btn.style.transform = 'translateY(0)';
        });
      });

      showNotification('Image ready! Follow the instructions to share', 'success');
    }

    function openWhatsAppDirect() {
      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

      if (isMobile) {
        window.open('whatsapp://send', '_blank');
      } else {
        window.open('https://web.whatsapp.com', '_blank');
      }
    }
  </script>