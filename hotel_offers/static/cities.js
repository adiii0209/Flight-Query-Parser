/* Destinations offered when a guest types where they want to go (enquiry.js). "City, Country" - free text is still accepted. */
window.HO_CITIES = [
  // India
  'Udaipur, India', 'Jaipur, India', 'Jodhpur, India', 'Jaisalmer, India', 'Pushkar, India', 'Ranthambore, India', 'Delhi, India', 'New Delhi, India', 'Agra, India', 'Varanasi, India',
  'Mumbai, India', 'Goa, India', 'Pune, India', 'Lonavala, India', 'Mahabaleshwar, India', 'Bengaluru, India', 'Mysuru, India', 'Coorg, India', 'Hampi, India', 'Chennai, India',
  'Pondicherry, India', 'Ooty, India', 'Kodaikanal, India', 'Madurai, India', 'Kochi, India', 'Munnar, India', 'Alleppey, India', 'Thekkady, India', 'Kovalam, India', 'Wayanad, India',
  'Hyderabad, India', 'Kolkata, India', 'Darjeeling, India', 'Gangtok, India', 'Shillong, India', 'Kaziranga, India', 'Guwahati, India', 'Bhubaneswar, India', 'Puri, India',
  'Shimla, India', 'Manali, India', 'Dharamshala, India', 'Dalhousie, India', 'Rishikesh, India', 'Haridwar, India', 'Dehradun, India', 'Mussoorie, India', 'Nainital, India', 'Jim Corbett, India',
  'Srinagar, India', 'Gulmarg, India', 'Pahalgam, India', 'Leh, India', 'Ladakh, India', 'Amritsar, India', 'Chandigarh, India', 'Lucknow, India', 'Khajuraho, India', 'Bhopal, India',
  'Ahmedabad, India', 'Kutch, India', 'Diu, India', 'Andaman Islands, India', 'Port Blair, India', 'Havelock Island, India', 'Lakshadweep, India',
  // South and Southeast Asia
  'Bali, Indonesia', 'Ubud, Indonesia', 'Seminyak, Indonesia', 'Nusa Dua, Indonesia', 'Uluwatu, Indonesia', 'Canggu, Indonesia', 'Jakarta, Indonesia', 'Yogyakarta, Indonesia', 'Lombok, Indonesia', 'Gili Islands, Indonesia', 'Komodo, Indonesia',
  'Bangkok, Thailand', 'Phuket, Thailand', 'Pattaya, Thailand', 'Krabi, Thailand', 'Koh Samui, Thailand', 'Chiang Mai, Thailand', 'Chiang Rai, Thailand', 'Hua Hin, Thailand', 'Koh Phi Phi, Thailand', 'Khao Lak, Thailand',
  'Singapore, Singapore', 'Kuala Lumpur, Malaysia', 'Langkawi, Malaysia', 'Penang, Malaysia', 'Kota Kinabalu, Malaysia', 'Malacca, Malaysia', 'Genting Highlands, Malaysia', 'Cameron Highlands, Malaysia',
  'Hanoi, Vietnam', 'Ho Chi Minh City, Vietnam', 'Da Nang, Vietnam', 'Hoi An, Vietnam', 'Ha Long Bay, Vietnam', 'Nha Trang, Vietnam', 'Phu Quoc, Vietnam', 'Sapa, Vietnam', 'Hue, Vietnam',
  'Siem Reap, Cambodia', 'Phnom Penh, Cambodia', 'Luang Prabang, Laos', 'Vientiane, Laos', 'Yangon, Myanmar', 'Bagan, Myanmar',
  'Manila, Philippines', 'Cebu, Philippines', 'Boracay, Philippines', 'Palawan, Philippines', 'El Nido, Philippines', 'Bohol, Philippines',
  'Maldives, Maldives', 'Male, Maldives', 'Colombo, Sri Lanka', 'Kandy, Sri Lanka', 'Galle, Sri Lanka', 'Sigiriya, Sri Lanka', 'Ella, Sri Lanka', 'Bentota, Sri Lanka', 'Nuwara Eliya, Sri Lanka',
  'Kathmandu, Nepal', 'Pokhara, Nepal', 'Chitwan, Nepal', 'Thimphu, Bhutan', 'Paro, Bhutan', 'Punakha, Bhutan', 'Dhaka, Bangladesh', 'Bandar Seri Begawan, Brunei',
  // East Asia and Central Asia
  'Tokyo, Japan', 'Kyoto, Japan', 'Osaka, Japan', 'Hiroshima, Japan', 'Nara, Japan', 'Hakone, Japan', 'Sapporo, Japan', 'Okinawa, Japan', 'Nagoya, Japan', 'Fukuoka, Japan', 'Hokkaido, Japan',
  'Seoul, South Korea', 'Busan, South Korea', 'Jeju, South Korea', 'Beijing, China', 'Shanghai, China', 'Hong Kong, China', 'Macau, China', 'Guangzhou, China', 'Chengdu, China', "Xi'an, China", 'Guilin, China', 'Shenzhen, China',
  'Taipei, Taiwan', 'Kaohsiung, Taiwan', 'Ulaanbaatar, Mongolia', 'Tashkent, Uzbekistan', 'Samarkand, Uzbekistan', 'Bukhara, Uzbekistan', 'Almaty, Kazakhstan', 'Astana, Kazakhstan', 'Bishkek, Kyrgyzstan', 'Baku, Azerbaijan', 'Tbilisi, Georgia', 'Batumi, Georgia', 'Yerevan, Armenia',
  // Middle East
  'Dubai, UAE', 'Abu Dhabi, UAE', 'Sharjah, UAE', 'Ras Al Khaimah, UAE', 'Fujairah, UAE', 'Doha, Qatar', 'Muscat, Oman', 'Salalah, Oman', 'Manama, Bahrain', 'Kuwait City, Kuwait', 'Riyadh, Saudi Arabia', 'Jeddah, Saudi Arabia', 'AlUla, Saudi Arabia',
  'Istanbul, Turkey', 'Cappadocia, Turkey', 'Antalya, Turkey', 'Bodrum, Turkey', 'Izmir, Turkey', 'Pamukkale, Turkey', 'Fethiye, Turkey', 'Amman, Jordan', 'Petra, Jordan', 'Wadi Rum, Jordan', 'Tel Aviv, Israel', 'Jerusalem, Israel', 'Beirut, Lebanon',
  // Europe
  'Paris, France', 'Nice, France', 'Cannes, France', 'Lyon, France', 'Marseille, France', 'Bordeaux, France', 'Strasbourg, France', 'Mont Saint-Michel, France', 'Provence, France', 'French Riviera, France',
  'London, United Kingdom', 'Edinburgh, United Kingdom', 'Manchester, United Kingdom', 'Liverpool, United Kingdom', 'Oxford, United Kingdom', 'Cambridge, United Kingdom', 'Bath, United Kingdom', 'Glasgow, United Kingdom', 'Cardiff, United Kingdom', 'Inverness, United Kingdom', 'Belfast, United Kingdom', 'Cotswolds, United Kingdom',
  'Dublin, Ireland', 'Galway, Ireland', 'Cork, Ireland', 'Rome, Italy', 'Venice, Italy', 'Florence, Italy', 'Milan, Italy', 'Naples, Italy', 'Amalfi Coast, Italy', 'Sorrento, Italy', 'Positano, Italy', 'Capri, Italy', 'Lake Como, Italy', 'Tuscany, Italy', 'Verona, Italy', 'Bologna, Italy', 'Turin, Italy', 'Sicily, Italy', 'Palermo, Italy', 'Cinque Terre, Italy', 'Sardinia, Italy', 'Dolomites, Italy',
  'Barcelona, Spain', 'Madrid, Spain', 'Seville, Spain', 'Granada, Spain', 'Valencia, Spain', 'Malaga, Spain', 'Ibiza, Spain', 'Mallorca, Spain', 'Tenerife, Spain', 'Bilbao, Spain', 'San Sebastian, Spain', 'Marbella, Spain', 'Cordoba, Spain', 'Toledo, Spain',
  'Lisbon, Portugal', 'Porto, Portugal', 'Algarve, Portugal', 'Madeira, Portugal', 'Azores, Portugal', 'Sintra, Portugal',
  'Berlin, Germany', 'Munich, Germany', 'Frankfurt, Germany', 'Hamburg, Germany', 'Cologne, Germany', 'Dresden, Germany', 'Heidelberg, Germany', 'Black Forest, Germany', 'Nuremberg, Germany', 'Stuttgart, Germany',
  'Amsterdam, Netherlands', 'Rotterdam, Netherlands', 'The Hague, Netherlands', 'Brussels, Belgium', 'Bruges, Belgium', 'Antwerp, Belgium', 'Luxembourg, Luxembourg',
  'Zurich, Switzerland', 'Geneva, Switzerland', 'Lucerne, Switzerland', 'Interlaken, Switzerland', 'Zermatt, Switzerland', 'St. Moritz, Switzerland', 'Bern, Switzerland', 'Lausanne, Switzerland', 'Grindelwald, Switzerland',
  'Vienna, Austria', 'Salzburg, Austria', 'Innsbruck, Austria', 'Hallstatt, Austria', 'Prague, Czech Republic', 'Brno, Czech Republic', 'Budapest, Hungary', 'Krakow, Poland', 'Warsaw, Poland', 'Gdansk, Poland', 'Bratislava, Slovakia', 'Ljubljana, Slovenia', 'Bled, Slovenia',
  'Athens, Greece', 'Santorini, Greece', 'Mykonos, Greece', 'Crete, Greece', 'Rhodes, Greece', 'Corfu, Greece', 'Naxos, Greece', 'Zakynthos, Greece', 'Thessaloniki, Greece', 'Meteora, Greece',
  'Dubrovnik, Croatia', 'Split, Croatia', 'Zagreb, Croatia', 'Hvar, Croatia', 'Plitvice, Croatia', 'Kotor, Montenegro', 'Budva, Montenegro', 'Sarajevo, Bosnia and Herzegovina', 'Mostar, Bosnia and Herzegovina', 'Belgrade, Serbia', 'Tirana, Albania', 'Sofia, Bulgaria', 'Bucharest, Romania', 'Transylvania, Romania',
  'Valletta, Malta', 'Limassol, Cyprus', 'Paphos, Cyprus', 'Larnaca, Cyprus', 'Monaco, Monaco',
  'Copenhagen, Denmark', 'Stockholm, Sweden', 'Gothenburg, Sweden', 'Oslo, Norway', 'Bergen, Norway', 'Tromso, Norway', 'Lofoten, Norway', 'Geilo, Norway', 'Helsinki, Finland', 'Rovaniemi, Finland', 'Reykjavik, Iceland', 'Akureyri, Iceland', 'Tallinn, Estonia', 'Riga, Latvia', 'Vilnius, Lithuania',
  'Moscow, Russia', 'Saint Petersburg, Russia', 'Kyiv, Ukraine',
  // Africa
  'Cairo, Egypt', 'Luxor, Egypt', 'Aswan, Egypt', 'Sharm El Sheikh, Egypt', 'Hurghada, Egypt', 'Marrakech, Morocco', 'Casablanca, Morocco', 'Fes, Morocco', 'Chefchaouen, Morocco', 'Tunis, Tunisia',
  'Cape Town, South Africa', 'Johannesburg, South Africa', 'Kruger National Park, South Africa', 'Durban, South Africa', 'Garden Route, South Africa', 'Stellenbosch, South Africa', 'Victoria Falls, Zimbabwe', 'Livingstone, Zambia',
  'Nairobi, Kenya', 'Maasai Mara, Kenya', 'Mombasa, Kenya', 'Diani Beach, Kenya', 'Arusha, Tanzania', 'Serengeti, Tanzania', 'Zanzibar, Tanzania', 'Kilimanjaro, Tanzania', 'Kigali, Rwanda', 'Entebbe, Uganda',
  'Mauritius, Mauritius', 'Seychelles, Seychelles', 'Mahe, Seychelles', 'Praslin, Seychelles', 'Reunion, Reunion', 'Madagascar, Madagascar', 'Windhoek, Namibia', 'Chobe, Botswana', 'Maun, Botswana', 'Accra, Ghana', 'Lagos, Nigeria', 'Dakar, Senegal', 'Addis Ababa, Ethiopia',
  // North America
  'New York, USA', 'Los Angeles, USA', 'San Francisco, USA', 'Las Vegas, USA', 'Miami, USA', 'Orlando, USA', 'Chicago, USA', 'Boston, USA', 'Washington DC, USA', 'Seattle, USA', 'San Diego, USA', 'New Orleans, USA', 'Nashville, USA', 'Austin, USA', 'Dallas, USA', 'Houston, USA', 'Atlanta, USA', 'Denver, USA', 'Philadelphia, USA', 'Phoenix, USA', 'Honolulu, USA', 'Maui, USA', 'Kauai, USA', 'Anchorage, USA', 'Grand Canyon, USA', 'Yellowstone, USA', 'Yosemite, USA', 'Napa Valley, USA', 'Aspen, USA', 'Key West, USA', 'Savannah, USA', 'Sedona, USA',
  'Toronto, Canada', 'Vancouver, Canada', 'Montreal, Canada', 'Quebec City, Canada', 'Banff, Canada', 'Jasper, Canada', 'Calgary, Canada', 'Ottawa, Canada', 'Niagara Falls, Canada', 'Whistler, Canada',
  'Mexico City, Mexico', 'Cancun, Mexico', 'Tulum, Mexico', 'Playa del Carmen, Mexico', 'Los Cabos, Mexico', 'Puerto Vallarta, Mexico', 'Oaxaca, Mexico', 'Guadalajara, Mexico',
  // Caribbean, Central and South America
  'Havana, Cuba', 'Varadero, Cuba', 'Punta Cana, Dominican Republic', 'Nassau, Bahamas', 'Montego Bay, Jamaica', 'Bridgetown, Barbados', 'San Juan, Puerto Rico', 'Aruba, Aruba', 'Curacao, Curacao', 'St. Lucia, Saint Lucia', 'Antigua, Antigua and Barbuda', 'Turks and Caicos, Turks and Caicos', 'Cayman Islands, Cayman Islands', 'Bora Bora, French Polynesia',
  'San Jose, Costa Rica', 'Panama City, Panama', 'Belize City, Belize', 'Antigua, Guatemala', 'Cartagena, Colombia', 'Bogota, Colombia', 'Medellin, Colombia', 'Lima, Peru', 'Cusco, Peru', 'Machu Picchu, Peru', 'Quito, Ecuador', 'Galapagos, Ecuador', 'La Paz, Bolivia', 'Uyuni, Bolivia',
  'Rio de Janeiro, Brazil', 'Sao Paulo, Brazil', 'Salvador, Brazil', 'Iguazu Falls, Brazil', 'Buenos Aires, Argentina', 'Patagonia, Argentina', 'Mendoza, Argentina', 'Ushuaia, Argentina', 'Santiago, Chile', 'Torres del Paine, Chile', 'Easter Island, Chile', 'Montevideo, Uruguay',
  // Oceania
  'Sydney, Australia', 'Melbourne, Australia', 'Brisbane, Australia', 'Gold Coast, Australia', 'Cairns, Australia', 'Perth, Australia', 'Adelaide, Australia', 'Uluru, Australia', 'Tasmania, Australia', 'Great Barrier Reef, Australia', 'Whitsundays, Australia', 'Darwin, Australia', 'Canberra, Australia',
  'Auckland, New Zealand', 'Queenstown, New Zealand', 'Wellington, New Zealand', 'Christchurch, New Zealand', 'Rotorua, New Zealand', 'Milford Sound, New Zealand', 'Fiji, Fiji', 'Nadi, Fiji', 'Tahiti, French Polynesia', 'Moorea, French Polynesia', 'Samoa, Samoa', 'Tonga, Tonga', 'Vanuatu, Vanuatu', 'Bali Nusa Dua, Indonesia', 'Guam, Guam',
  // Cruises and polar
  'Antarctica, Antarctica', 'Svalbard, Norway', 'Greenland, Greenland',
];
