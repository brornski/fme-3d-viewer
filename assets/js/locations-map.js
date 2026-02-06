/* locations-map.js — Interactive MapLibre GL map for Team Dental locations
   Inspired by mapcn: dark CARTO basemap, animated markers, fly-to, route lines */

(function () {
    'use strict';

    var locations = [
        {
            id: 'nyc',
            name: 'New York City',
            address: '251 E 33rd St, 4th Floor',
            city: 'New York, NY 10016',
            phone: '212-482-1212',
            phoneRaw: '2124821212',
            email: 'NYC@team-dental.com',
            coords: [-73.9782, 40.7462],
            directions: 'https://maps.google.com/?q=251+E+33rd+St+4th+Floor+New+York+NY+10016',
            image: 'assets/images/loc-nyc.png'
        },
        {
            id: 'philly',
            name: 'Philadelphia',
            address: '992 N 2nd St',
            city: 'Philadelphia, PA 19123',
            phone: '215-598-5100',
            phoneRaw: '2155985100',
            email: 'Northernliberties@team-dental.com',
            coords: [-75.1392, 39.9665],
            directions: 'https://maps.google.com/?q=992+N+2nd+St+Philadelphia+PA+19123',
            image: 'assets/images/loc-philly.jpg'
        },
        {
            id: 'swedesboro',
            name: 'Swedesboro',
            address: '300 Lexington Rd Suite 220',
            city: 'Swedesboro, NJ 08085',
            phone: '856-467-4677',
            phoneRaw: '8564674677',
            email: 'Swedesboro@team-dental.com',
            coords: [-75.3104, 39.7476],
            directions: 'https://maps.google.com/?q=300+Lexington+Rd+Suite+220+Swedesboro+NJ+08085',
            image: 'assets/images/loc-swedesboro.jpg'
        },
        {
            id: 'ponte-vedra',
            name: 'Ponte Vedra Beach',
            address: '3109 Sawgrass Village Circle',
            city: 'Ponte Vedra Beach, FL',
            phone: '904-273-9115',
            phoneRaw: '9042739115',
            email: '',
            coords: [-81.3858, 30.1736],
            directions: 'https://maps.google.com/?q=3109+Sawgrass+Village+Circle+Ponte+Vedra+Beach+FL',
            image: 'assets/images/loc-ponte-vedra.png'
        },
        {
            id: 'vermont',
            name: 'Vermont',
            address: '71 Knight Lane Suite 10',
            city: 'Williston, VT 05495',
            phone: '802-876-7803',
            phoneRaw: '8028767803',
            email: '',
            coords: [-73.0876, 44.4368],
            directions: 'https://maps.google.com/?q=71+Knight+Lane+Suite+10+Williston+VT+05495',
            image: 'assets/images/loc-vermont.jpg'
        }
    ];

    var activeMarkerId = null;
    var map;

    function init() {
        var container = document.getElementById('locations-map');
        if (!container || typeof maplibregl === 'undefined') return;

        map = new maplibregl.Map({
            container: 'locations-map',
            style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
            center: [-76.5, 37.5],
            zoom: 4.2,
            pitch: 0,
            bearing: 0,
            minZoom: 3,
            maxZoom: 17,
            attributionControl: false
        });

        map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
        map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), 'bottom-right');

        map.on('load', function () {
            addRouteLine();
            addMarkers();
            entranceAnimation();
        });

        bindSidebarCards();
        bindDetailCards();

        var resetBtn = document.getElementById('map-reset');
        if (resetBtn) resetBtn.addEventListener('click', resetView);
    }

    function addRouteLine() {
        // North to south: Vermont → NYC → Philly → Swedesboro → Ponte Vedra
        var routeCoords = [
            locations[4].coords,
            locations[0].coords,
            locations[1].coords,
            locations[2].coords,
            locations[3].coords
        ];

        map.addSource('route', {
            type: 'geojson',
            data: {
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: routeCoords }
            }
        });

        // Glow behind the line
        map.addLayer({
            id: 'route-glow',
            type: 'line',
            source: 'route',
            paint: {
                'line-color': '#4A9FD4',
                'line-width': 6,
                'line-opacity': 0.08,
                'line-blur': 4
            }
        });

        // Main dashed line
        map.addLayer({
            id: 'route-line',
            type: 'line',
            source: 'route',
            paint: {
                'line-color': '#4A9FD4',
                'line-width': 2,
                'line-opacity': 0.45,
                'line-dasharray': [3, 3]
            }
        });
    }

    function addMarkers() {
        locations.forEach(function (loc) {
            var el = document.createElement('div');
            el.className = 'map-marker';
            el.dataset.location = loc.id;
            el.innerHTML =
                '<div class="map-marker-pulse"></div>' +
                '<div class="map-marker-dot"></div>' +
                '<span class="map-marker-label">' + loc.name + '</span>';

            var popupHTML =
                '<div class="map-popup-inner">' +
                    '<h3>' + loc.name + '</h3>' +
                    '<p class="map-popup-addr">' + loc.address + '<br>' + loc.city + '</p>' +
                    '<a href="tel:' + loc.phoneRaw + '" class="map-popup-phone">' + loc.phone + '</a>' +
                    (loc.email ? '<a href="mailto:' + loc.email + '" class="map-popup-email">' + loc.email + '</a>' : '') +
                    '<div class="map-popup-btns">' +
                        '<a href="' + loc.directions + '" target="_blank" rel="noopener" class="map-popup-btn">Directions</a>' +
                        '<a href="contact.html" class="map-popup-btn primary">Book Visit</a>' +
                    '</div>' +
                '</div>';

            var popup = new maplibregl.Popup({
                offset: 24,
                closeButton: true,
                closeOnClick: false,
                className: 'td-popup',
                maxWidth: '300px'
            }).setHTML(popupHTML);

            var marker = new maplibregl.Marker({ element: el })
                .setLngLat(loc.coords)
                .setPopup(popup)
                .addTo(map);

            el.addEventListener('click', function () {
                flyToLocation(loc.id);
            });

            loc.marker = marker;
            loc.popup = popup;
        });
    }

    function flyToLocation(locationId) {
        var loc = locations.find(function (l) { return l.id === locationId; });
        if (!loc) return;

        // Close all popups, remove active states
        locations.forEach(function (l) {
            if (l.popup) l.popup.remove();
            if (l.marker) l.marker.getElement().classList.remove('active');
        });

        // Update sidebar
        document.querySelectorAll('.map-loc-item').forEach(function (item) {
            item.classList.toggle('active', item.dataset.location === locationId);
        });

        // Fly
        map.flyTo({
            center: loc.coords,
            zoom: 14,
            pitch: 50,
            bearing: -15,
            duration: 2200,
            essential: true
        });

        // Show popup after flight
        setTimeout(function () {
            if (loc.marker) {
                loc.marker.togglePopup();
                loc.marker.getElement().classList.add('active');
            }
        }, 2000);

        activeMarkerId = locationId;
    }

    function resetView() {
        locations.forEach(function (l) {
            if (l.popup) l.popup.remove();
            if (l.marker) l.marker.getElement().classList.remove('active');
        });
        document.querySelectorAll('.map-loc-item').forEach(function (item) {
            item.classList.remove('active');
        });

        map.flyTo({
            center: [-76.5, 37.5],
            zoom: 5.2,
            pitch: 25,
            bearing: 0,
            duration: 1800
        });

        activeMarkerId = null;
    }

    function entranceAnimation() {
        setTimeout(function () {
            map.flyTo({
                center: [-76.5, 37.5],
                zoom: 5.2,
                pitch: 25,
                bearing: 0,
                duration: 2800,
                essential: true
            });
        }, 400);
    }

    function bindSidebarCards() {
        document.querySelectorAll('.map-loc-item').forEach(function (item) {
            item.addEventListener('click', function () {
                var locId = item.dataset.location;
                if (activeMarkerId === locId) {
                    resetView();
                } else {
                    flyToLocation(locId);
                }
            });
        });
    }

    function bindDetailCards() {
        document.querySelectorAll('.loc-detail-fly').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                var locId = btn.dataset.location;
                flyToLocation(locId);
                var mapEl = document.getElementById('locations-map');
                if (mapEl) mapEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            });
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
