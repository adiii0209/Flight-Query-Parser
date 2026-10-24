/* Trips: perk icons, the same line icons the offer posters use (posters.js), so a perk looks the same in a deal and on a trip. */
(function (TT) {
  const PATHS = {
    credit: '<rect x="2.5" y="5" width="19" height="14" rx="2.2"/><path d="M2.5 10h19"/><path d="M6 15h3.5M16 15h2"/>',
    breakfast: '<path d="M5 11h12v4a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z"/><path d="M17 12h1.4a2.4 2.4 0 0 1 0 4.8H16.5"/><path d="M4 21.5h14"/><path d="M8 2.5c0 1.6 1 1.6 1 3.2M11 2.5c0 1.6 1 1.6 1 3.2M14 2.5c0 1.6 1 1.6 1 3.2"/>',
    upgrade: '<path d="M12 2.5l2.9 6.2 6.6.8-4.9 4.6 1.3 6.7L12 17.5l-5.9 3.3 1.3-6.7L2.5 9.5l6.6-.8z"/>',
    checkin: '<circle cx="12" cy="12" r="9.2"/><path d="M12 6.8V12l3.4 2.2"/>',
    welcome: '<path d="M7.5 3h9l-1 7.2a3.5 3.5 0 0 1-7 0z"/><path d="M12 13.7V21"/><path d="M8 21h8"/>',
    spa: '<path d="M12 21c-5 0-8-3-8-8 5 0 8 3 8 8z"/><path d="M12 21c5 0 8-3 8-8-5 0-8 3-8 8z"/><path d="M12 21C9 18 9 12 12 7c3 5 3 11 0 14z"/>',
    transfer: '<path d="M5 15.5l1.6-5A2 2 0 0 1 8.5 9h7a2 2 0 0 1 1.9 1.5l1.6 5"/><rect x="3" y="15.5" width="18" height="4.5" rx="1.6"/><circle cx="7.5" cy="17.7" r=".6"/><circle cx="16.5" cy="17.7" r=".6"/>',
    dining: '<path d="M7 3v8M4.5 3v5.5a2.5 2.5 0 0 0 5 0V3M7 11v10"/><path d="M17.5 3C15 5 14 8 14 11h3.5v10"/>',
    gift: '<rect x="3" y="8" width="18" height="4"/><path d="M12 8v13"/><path d="M19.5 12v9h-15v-9"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
    wifi: '<path d="M2 9a15 15 0 0 1 20 0"/><path d="M5 12.5a10 10 0 0 1 14 0"/><path d="M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r=".8"/>',
  };
  TT.perkNames = [['breakfast', 'Breakfast'], ['credit', 'Credit'], ['upgrade', 'Upgrade'], ['checkin', 'Check-in / out'], ['welcome', 'Welcome'],
    ['spa', 'Spa'], ['transfer', 'Transfer'], ['dining', 'Dining'], ['gift', 'Gift'], ['wifi', 'Wi-Fi']];
  TT.perkText = { credit: 'Resort credits', breakfast: 'Daily breakfast', upgrade: 'Room upgrade*', checkin: 'Early check-in / late check-out*', welcome: 'VIP welcome',
    spa: 'Spa treatment', transfer: 'Airport transfers', dining: 'Dining credit', gift: 'Welcome gift', wifi: 'Complimentary Wi-Fi' };
  TT.perkIcon = name => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (PATHS[name] || PATHS.gift) + '</svg>';
})(window.TT);
