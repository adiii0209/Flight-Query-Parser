// billingModule.js
// Handles Billing To selection and Passenger linking

const BillingModule = {
    state: {
        billingAccounts: [],
        selectedBillingAccount: null,
        linkedPassengers: [],
        selectedPassengerIds: []
    },

    init() {
        this.cacheDOM();
        this.bindEvents();
        this.fetchBillingAccounts();
    },

    cacheDOM() {
        this.billingSearchInput = document.getElementById('flightBillingSearchInput');
        this.billingDropdown = document.getElementById('billingDropdown');
    },

    bindEvents() {
        if(this.billingSearchInput) {
            let debounceTimer;
            this.billingSearchInput.addEventListener('input', (e) => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    this.handleSearch(e.target.value);
                    this.showDropdown();
                }, 300);
            });
            this.billingSearchInput.addEventListener('focus', (e) => {
                this.handleSearch(e.target.value);
                this.showDropdown();
            });
            this.billingSearchInput.addEventListener('click', (e) => {
                this.showDropdown();
            });
            // Click outside to close dropdown
            document.addEventListener('click', (e) => {
                if (!e.target.closest('#billingSearchContainer')) {
                    this.hideDropdown();
                }
            });
        }
    },

    async fetchBillingAccounts() {
        try {
            const response = await fetch('/api/v2/billing-accounts');
            if (response.ok) {
                const data = await response.json();
                this.state.billingAccounts = data.billing_accounts || [];
                this.renderDropdown(this.state.billingAccounts);
            }
        } catch (error) {
            console.error('Error fetching billing accounts:', error);
        }
    },

    handleSearch(query) {
        if (!query) {
            this.renderDropdown(this.state.billingAccounts);
            return;
        }
        const lowerQuery = query.toLowerCase();
        const filtered = this.state.billingAccounts.filter(acc => 
            (acc.display_name && acc.display_name.toLowerCase().includes(lowerQuery)) ||
            (acc.company_name && acc.company_name.toLowerCase().includes(lowerQuery))
        );
        this.renderDropdown(filtered);
    },

    showDropdown() {
        if(this.billingDropdown) {
            this.billingDropdown.style.display = 'block';
        }
    },

    hideDropdown() {
        if(this.billingDropdown) {
            this.billingDropdown.style.display = 'none';
        }
    },

    renderDropdown(accounts) {
        if (!this.billingDropdown) return;
        this.billingDropdown.innerHTML = '';
        
        if (accounts.length === 0) {
            this.billingDropdown.innerHTML = '<div class="dropdown-item" style="padding: 12px 15px; color: var(--text-secondary); border-bottom: 1px solid var(--border);">No matching accounts found</div>';
        } else {
            accounts.forEach(acc => {
                const div = document.createElement('div');
                div.className = 'dropdown-item';
                div.style.padding = '12px 15px';
                div.style.cursor = 'pointer';
                div.style.borderBottom = '1px solid var(--border)';
                div.style.transition = 'background 0.2s';
                div.innerHTML = `<strong>${acc.display_name}</strong> <span style="font-size: 0.8rem; color: var(--text-secondary)">${acc.account_type}</span>`;
                
                // Hover effect
                div.addEventListener('mouseenter', () => { div.style.backgroundColor = 'var(--bg-main)'; });
                div.addEventListener('mouseleave', () => { div.style.backgroundColor = 'transparent'; });

                div.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.selectAccount(acc);
                });
                this.billingDropdown.appendChild(div);
            });
        }
        
        // Always append "Create New" if there is a search term
        const query = this.billingSearchInput ? this.billingSearchInput.value.trim() : '';
        if (query.length > 0) {
            const createDiv = document.createElement('div');
            createDiv.className = 'search-item';
            createDiv.style.padding = '12px 15px';
            createDiv.style.cursor = 'pointer';
            createDiv.style.display = 'flex';
            createDiv.style.alignItems = 'center';
            createDiv.style.gap = '12px';
            createDiv.style.transition = 'background 0.2s';
            createDiv.style.background = 'rgba(37, 99, 235, 0.05)';
            createDiv.style.color = 'var(--primary)';
            createDiv.innerHTML = `
                <div class="avatar" style="width:36px; height:36px; border-radius:50%; background:var(--primary); color:white; display:flex; align-items:center; justify-content:center; font-weight:bold; flex-shrink:0; font-size:16px;">+</div>
                <div style="flex-grow:1; line-height:1.4;">
                  <div style="font-weight:600; font-size:0.95rem;">Create New: "${query.replace(/'/g, "\\'")}"</div>
                  <div style="font-size:0.8rem; opacity:0.8;">Open form to add billing details</div>
                </div>
            `;
            createDiv.addEventListener('mouseenter', () => { createDiv.style.backgroundColor = 'rgba(37, 99, 235, 0.1)'; });
            createDiv.addEventListener('mouseleave', () => { createDiv.style.backgroundColor = 'rgba(37, 99, 235, 0.05)'; });
            
            createDiv.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log("Create new billing account clicked, query:", query);
                if (window.openQuickAddBillingModal) {
                    window.openQuickAddBillingModal(query);
                } else if (typeof openQuickAddBillingModal !== 'undefined') {
                    openQuickAddBillingModal(query);
                } else {
                    console.error("openQuickAddBillingModal is not defined!");
                }
            });
            this.billingDropdown.appendChild(createDiv);
        }
    },

    async selectAccount(account) {
        this.state.selectedBillingAccount = account;
        this.state.selectedPassengerIds = []; // reset
        if(this.billingSearchInput) {
            this.billingSearchInput.value = account.display_name;
        }
        this.hideDropdown();

        // Update the global billing account select so submitItinerary works
        const billingSelect = document.getElementById('billingAccountSelect');
        if (billingSelect) {
            billingSelect.value = account.id;
        }
        // Tell index.html we selected from DB, not ad-hoc
        if (typeof tempBillingDetails !== 'undefined') {
            tempBillingDetails = null;
        }
        
        // Fetch passengers
        await this.fetchLinkedPassengers(account.id);
    },

    async fetchLinkedPassengers(accountId) {
        try {
            const response = await fetch(`/api/v2/billing-accounts/${accountId}/passengers`);
            if (response.ok) {
                const data = await response.json();
                this.state.linkedPassengers = data.passengers || [];
            }
        } catch (error) {
            console.error('Error fetching linked passengers:', error);
            this.state.linkedPassengers = [];
        }
    },

    getSelectedData() {
        return {
            billingAccountId: this.state.selectedBillingAccount ? this.state.selectedBillingAccount.id : null,
            passengerIds: this.state.selectedPassengerIds,
            passengers: this.state.linkedPassengers.filter(p => this.state.selectedPassengerIds.includes(p.id))
        };
    }
};

window.BillingModule = BillingModule;
