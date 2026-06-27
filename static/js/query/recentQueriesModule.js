// recentQueriesModule.js
// Handles fetching and displaying recent queries (itineraries)

const RecentQueriesModule = {
    state: {
        recentQueries: []
    },

    init() {
        this.cacheDOM();
        this.bindEvents();
        // Fetch when modal opens instead of on init to avoid double calls
    },

    cacheDOM() {
        this.recentQueriesBtn = document.getElementById('recentQueriesBtn');
        this.recentQueriesModal = document.getElementById('recentQueriesModal');
        this.closeRecentQueriesBtn = document.getElementById('closeRecentQueriesBtn');
        this.recentQueriesContainer = document.getElementById('recentQueriesContainer');
        this.queryDetailModal = document.getElementById('queryDetailModal');
        this.closeQueryDetailBtn = document.getElementById('closeQueryDetailBtn');
        this.queryDetailContent = document.getElementById('queryDetailContent');
    },

    bindEvents() {
        if(this.recentQueriesBtn) {
            this.recentQueriesBtn.addEventListener('click', () => this.openModal());
        }
        if(this.closeRecentQueriesBtn) {
            this.closeRecentQueriesBtn.addEventListener('click', () => this.closeModal());
        }
        if(this.closeQueryDetailBtn) {
            this.closeQueryDetailBtn.addEventListener('click', () => this.closeDetailModal());
        }
    },

    async fetchRecentQueries() {
        try {
            if (this.isFetching) return;
            
            // Use cache if fetched within last 60 seconds
            const now = Date.now();
            if (this.lastFetchTime && (now - this.lastFetchTime < 60000) && this.state.recentQueries.length > 0) {
                this.renderQueries();
                return;
            }
            
            this.isFetching = true;
            const response = await fetch('/api/v2/itineraries?limit=20'); 
            if (response.ok) {
                const data = await response.json();
                this.state.recentQueries = data.itineraries || [];
                this.lastFetchTime = Date.now();
                this.renderQueries();
            }
        } catch (error) {
            console.error('Error fetching recent queries:', error);
        } finally {
            this.isFetching = false;
        }
    },

    renderQueries() {
        if (!this.recentQueriesContainer) return;
        this.recentQueriesContainer.innerHTML = '';
        
        if (this.state.recentQueries.length === 0) {
            this.recentQueriesContainer.innerHTML = '<p class="text-muted">No recent queries found.</p>';
            return;
        }

        this.state.recentQueries.slice(0, 20).forEach(query => {
            const card = document.createElement('div');
            card.className = 'query-card';
            card.style.cssText = `
                background: var(--bg-card);
                border: 1px solid var(--border);
                border-radius: 12px;
                padding: 16px;
                margin-bottom: 16px;
                cursor: pointer;
                transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                box-shadow: var(--shadow);
                position: relative;
                overflow: hidden;
            `;
            
            card.onmouseenter = () => { 
                card.style.transform = 'translateY(-3px)'; 
                card.style.boxShadow = 'var(--shadow-lg)'; 
                card.style.borderColor = 'var(--primary)';
            };
            card.onmouseleave = () => { 
                card.style.transform = 'translateY(0)'; 
                card.style.boxShadow = 'var(--shadow)'; 
                card.style.borderColor = 'var(--border)';
            };

            const date = new Date(query.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
            const route = query.route_text || 'Unknown Route';
            const billTo = query.bill_to_name || 'No Billing';
            const passengers = query.passengers_data && query.passengers_data.length > 0 
                ? query.passengers_data.map(p => p.first_name + ' ' + (p.last_name || '')).join(', ') 
                : 'None';
            const amount = query.total_amount ? `₹${query.total_amount.toLocaleString()}` : '-';
            const timings = query.first_flight_time ? `<div style="display: flex; align-items: center; gap: 4px; font-size: 0.85rem; color: var(--text-secondary); margin-top: 2px;"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.7;"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg> ${query.first_flight_time}</div>` : '';
            const tripTypeFormatted = query.trip_type ? query.trip_type.replace('_', ' ').toUpperCase() : 'ONE WAY';
            let formattedRoute = route;
            if (formattedRoute !== 'Unknown Route') {
                formattedRoute = formattedRoute.replace(/ <-> /g, ' <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.6; flex-shrink: 0;"><path d="M7 10L3 14l4 4"/><path d="M21 10H3"/><path d="M17 14l4-4-4-4"/><path d="M3 10h18"/></svg> ');
                formattedRoute = formattedRoute.replace(/ -> /g, ' <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.6; flex-shrink: 0;"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg> ');
            }
            
            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; border-bottom: 1px solid var(--border); padding-bottom: 8px;">
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <span style="font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">${date}</span>
                        <span style="font-size: 0.7rem; background: var(--bg-main); color: var(--text-secondary); padding: 2px 6px; border-radius: 4px; font-weight: 700; border: 1px solid var(--border);">${tripTypeFormatted}</span>
                    </div>
                    <span style="font-size: 0.75rem; font-weight: 600; background: ${query.status === 'draft' ? 'var(--bg-main)' : 'var(--primary)'}; color: ${query.status === 'draft' ? 'var(--text-primary)' : 'white'}; padding: 4px 8px; border-radius: 12px; border: 1px solid ${query.status === 'draft' ? 'var(--border)' : 'transparent'}; text-transform: uppercase; letter-spacing: 0.5px;">${query.status}</span>
                </div>
                <div style="margin-bottom: 12px;">
                    <h4 style="margin: 0 0 4px 0; font-size: 1.15rem; font-weight: 700; color: var(--text-primary); letter-spacing: -0.5px; display: flex; align-items: center; flex-wrap: wrap; gap: 6px;">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.2-1.1.6L3 8l6 5.5-3.2 3.2-3.3-1-1.3 1.3 4.4 2.8 2.8 4.4 1.3-1.3-1-3.3 3.2-3.2 5.5 6 1.2-.7c.4-.2.7-.6.6-1.1z"/></svg>
                        <span style="display: flex; align-items: center; flex-wrap: wrap; gap: 6px;">${formattedRoute}</span>
                    </h4>
                    ${timings}
                    <div style="font-size: 1rem; font-weight: 600; color: var(--success); margin-top: 6px;">${amount}</div>
                </div>
                <div style="display: flex; flex-direction: column; gap: 6px;">
                    <div style="display: flex; align-items: center; gap: 8px; font-size: 0.85rem; color: var(--text-secondary);">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.7;"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"></rect><path d="M9 22v-4h6v4"></path><path d="M8 6h.01"></path><path d="M16 6h.01"></path><path d="M12 6h.01"></path><path d="M12 10h.01"></path><path d="M12 14h.01"></path><path d="M16 10h.01"></path><path d="M16 14h.01"></path><path d="M8 10h.01"></path><path d="M8 14h.01"></path></svg>
                        <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${billTo}</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px; font-size: 0.85rem; color: var(--text-secondary);">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.7;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                        <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${passengers}</span>
                    </div>
                </div>
            `;
            
            card.addEventListener('click', () => {
                window.location.href = '/itineraries#' + query.id;
            });
            this.recentQueriesContainer.appendChild(card);
        });
    },

    showQueryDetails(query) {
        if (!this.queryDetailContent) return;
        
        let flightsHtml = '';
        if (query.flights && query.flights.length > 0) {
            flightsHtml = query.flights.map((f, i) => `
                <div style="padding: 8px; background: var(--bg-main); margin-bottom: 8px; border-radius: 4px;">
                    <strong>Option ${i+1}:</strong> ${f.flight_number || ''} ${f.departure_code || ''} -> ${f.arrival_code || ''}
                    <br><span style="font-size: 0.85rem;">Dep: ${f.departure_time || 'N/A'}, Arr: ${f.arrival_time || 'N/A'}</span>
                    <br><span style="font-size: 0.85rem; color: var(--success);">Price: ${f.price || 'N/A'}</span>
                </div>
            `).join('');
        } else {
            flightsHtml = '<p>No flights data available.</p>';
        }

        this.queryDetailContent.innerHTML = `
            <h3 style="margin-bottom: 12px; color: var(--text-primary);">${query.route || 'Itinerary Details'}</h3>
            <p><strong>Status:</strong> ${query.status}</p>
            <p><strong>Total Amount:</strong> ₹${query.total_amount || 0}</p>
            <p><strong>Billing To:</strong> ${query.bill_to_name || 'N/A'}</p>
            <hr style="margin: 16px 0; border: none; border-top: 1px solid var(--border);">
            <h4 style="margin-bottom: 8px; color: var(--text-primary);">Flights</h4>
            ${flightsHtml}
        `;
        
        this.openDetailModal();
    },

    openModal() {
        if(this.recentQueriesModal) {
            this.fetchRecentQueries(); // Refresh on open
            this.recentQueriesModal.style.display = 'flex';
            this.recentQueriesModal.classList.add('active');
        }
    },

    closeModal() {
        if(this.recentQueriesModal) {
            this.recentQueriesModal.classList.remove('active');
            setTimeout(() => { this.recentQueriesModal.style.display = 'none'; }, 200);
        }
    },

    openDetailModal() {
        if(this.queryDetailModal) {
            this.queryDetailModal.style.display = 'flex';
            this.queryDetailModal.classList.add('active');
        }
    },

    closeDetailModal() {
        if(this.queryDetailModal) {
            this.queryDetailModal.classList.remove('active');
            setTimeout(() => { this.queryDetailModal.style.display = 'none'; }, 200);
        }
    }
};

window.RecentQueriesModule = RecentQueriesModule;
