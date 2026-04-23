/* global L, CONFIG */

(function () {
  "use strict";

  const DEFAULT_CITY = "Delhi";
  const DEFAULT_COORDS = [28.6139, 77.2090];
  const WAQI_BASE_URL = "https://api.waqi.info";
  const MAX_AQI_FOR_SCALE = 300;

  const AQI_LEVELS = [
    {
      max: 50,
      key: "good",
      label: "Good",
      color: "#1f9d55",
      tip: "Air quality is good. It is a comfortable time for outdoor plans."
    },
    {
      max: 100,
      key: "moderate",
      label: "Moderate",
      color: "#c89208",
      tip: "Air quality is acceptable. Sensitive groups may prefer shorter outdoor activity."
    },
    {
      max: 150,
      key: "unhealthy-sensitive",
      label: "Unhealthy for Sensitive Groups",
      color: "#f2994a",
      tip: "Children, older adults, and people with breathing concerns should reduce prolonged exertion."
    },
    {
      max: 200,
      key: "unhealthy",
      label: "Unhealthy",
      color: "#eb5757",
      tip: "Limit outdoor activity. Consider a mask outdoors and keep windows closed near traffic."
    },
    {
      max: 300,
      key: "very-unhealthy",
      label: "Very Unhealthy",
      color: "#9b51e0",
      tip: "Avoid outdoor exertion. Run air purification indoors if available."
    },
    {
      max: Infinity,
      key: "hazardous",
      label: "Hazardous",
      color: "#7f1d1d",
      tip: "Stay indoors and avoid physical exertion. Follow local health guidance."
    }
  ];

  const POLLUTANT_LABELS = {
    pm25: "PM2.5",
    pm10: "PM10",
    o3: "O3",
    no2: "NO2",
    so2: "SO2",
    co: "CO"
  };

  const state = {
    map: null,
    markersLayer: null,
    selectedCoords: DEFAULT_COORDS,
    selectedCity: DEFAULT_CITY,
    lastStation: null,
    isLoading: false
  };

  const els = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    cacheElements();
    bindEvents();
    initMap();
    console.log("[BreatheSmart] Dashboard initialized");
    fetchCityAQI(DEFAULT_CITY);
  }

  function cacheElements() {
    els.searchForm = document.querySelector("#city-search-form");
    els.searchInput = document.querySelector("#city-search-input");
    els.searchButton = document.querySelector("#city-search-button");
    els.locationButton = document.querySelector("#my-location-button");
    els.liveStatus = document.querySelector("#live-status");
    els.liveStatusText = document.querySelector("#live-status-text");
    els.cityName = document.querySelector("#city-name");
    els.lastUpdated = document.querySelector("#last-updated");
    els.aqiNumber = document.querySelector("#aqi-number");
    els.aqiLabel = document.querySelector("#aqi-label");
    els.scaleMarker = document.querySelector("#aqi-scale-marker");
    els.healthTip = document.querySelector("#health-tip-text");
    els.pollutantsGrid = document.querySelector("#pollutants-grid");
    els.stationCount = document.querySelector("#station-count");
    els.stationsList = document.querySelector("#nearby-stations-list");
    els.mapResetButton = document.querySelector("#map-reset-button");
    els.loadingOverlay = document.querySelector("#loading-overlay");
    els.loadingMessage = document.querySelector("#loading-message");
    els.errorOverlay = document.querySelector("#error-overlay");
    els.errorMessage = document.querySelector("#error-message");
    els.errorDismissButton = document.querySelector("#error-dismiss-button");
    els.modal = document.querySelector("#station-modal");
    els.modalTitle = document.querySelector("#station-modal-title");
    els.modalBody = document.querySelector("#station-modal-body");
    els.modalClose = document.querySelector("#station-modal-close");
  }

  function bindEvents() {
    els.searchForm?.addEventListener("submit", handleSearchSubmit);
    els.locationButton?.addEventListener("click", handleLocationClick);
    els.mapResetButton?.addEventListener("click", resetMapView);
    els.errorDismissButton?.addEventListener("click", hideError);
    els.modalClose?.addEventListener("click", closeStationModal);

    els.modal?.addEventListener("click", function (event) {
      if (event.target === els.modal) {
        closeStationModal();
      }
    });
  }

  function initMap() {
    const mapElement = document.querySelector("#map");

    if (!mapElement || typeof L === "undefined") {
      console.warn("[BreatheSmart] Leaflet is unavailable or map element is missing");
      showError("Map library could not load. AQI details can still appear in the sidebar.");
      return;
    }

    state.map = L.map(mapElement, {
      zoomControl: true,
      preferCanvas: true
    }).setView(DEFAULT_COORDS, 10);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(state.map);

    state.markersLayer = L.layerGroup().addTo(state.map);
    console.log("[BreatheSmart] Leaflet map ready");
  }

  async function handleSearchSubmit(event) {
    event.preventDefault();
    const city = els.searchInput?.value?.trim();

    if (!city) {
      showError("Please enter a city name before searching.");
      return;
    }

    await fetchCityAQI(city);
  }

  function handleLocationClick() {
    if (!navigator.geolocation) {
      showError("Geolocation is not available in this browser.");
      return;
    }

    setLoading(true, "Finding your location...");
    setControlState(true);

    navigator.geolocation.getCurrentPosition(
      async function (position) {
        const latitude = position?.coords?.latitude;
        const longitude = position?.coords?.longitude;

        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          setLoading(false);
          setControlState(false);
          showError("Your browser returned an invalid location.");
          return;
        }

        console.log("[BreatheSmart] Geolocation acquired", { latitude, longitude });
        await fetchAQIByCoords(latitude, longitude);
      },
      function (error) {
        console.warn("[BreatheSmart] Geolocation failed", error);
        setLoading(false);
        setControlState(false);
        showError(error?.message || "Unable to access your location.");
      },
      {
        enableHighAccuracy: false,
        timeout: 10000,
        maximumAge: 300000
      }
    );
  }

  async function fetchCityAQI(city) {
    console.log("[BreatheSmart] Fetching city AQI", city);
    state.selectedCity = city;
    setLoading(true, `Loading AQI for ${city}...`);
    setControlState(true);

    try {
      const station = await fetchWAQI(`/feed/${encodeURIComponent(city)}/`);
      const normalized = normalizeStation(station?.data);

      if (!normalized) {
        throw new Error("WAQI returned an invalid city response.");
      }

      updateSidebar(normalized);
      updateSelectedStation(normalized);
      await fetchNearbyStations(normalized.lat, normalized.lon);
      setLiveStatus("Live data loaded", "live");
    } catch (error) {
      console.error("[BreatheSmart] City AQI failed", error);
      showFallbackUI(city);
      showError(error?.message || "Unable to load city AQI.");
      setLiveStatus("AQI unavailable", "error");
    } finally {
      setLoading(false);
      setControlState(false);
    }
  }

  async function fetchAQIByCoords(latitude, longitude) {
    console.log("[BreatheSmart] Fetching AQI by coordinates", { latitude, longitude });

    try {
      const station = await fetchWAQI(`/feed/geo:${latitude};${longitude}/`);
      const normalized = normalizeStation(station?.data);

      if (!normalized) {
        throw new Error("WAQI returned an invalid location response.");
      }

      updateSidebar(normalized);
      updateSelectedStation(normalized);
      await fetchNearbyStations(normalized.lat, normalized.lon);
      setLiveStatus("Live data loaded", "live");
    } catch (error) {
      console.error("[BreatheSmart] Location AQI failed", error);
      showFallbackUI("Your location");
      showError(error?.message || "Unable to load AQI for your location.");
      setLiveStatus("AQI unavailable", "error");
    } finally {
      setLoading(false);
      setControlState(false);
    }
  }

  async function fetchNearbyStations(latitude, longitude) {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      console.warn("[BreatheSmart] Skipping nearby stations: invalid coordinates");
      renderNearbyStations([]);
      return;
    }

    console.log("[BreatheSmart] Fetching nearby stations", { latitude, longitude });
    const delta = 0.35;
    const bounds = [
      latitude - delta,
      longitude - delta,
      latitude + delta,
      longitude + delta
    ];

    try {
      const response = await fetchWAQI(`/map/bounds/?latlng=${bounds.join(",")}`);
      const stations = Array.isArray(response?.data) ? response.data : [];
      const normalizedStations = stations
        .map(function (station) {
          try {
            return normalizeMapStation(station);
          } catch (error) {
            console.warn("[BreatheSmart] Broken station skipped", station, error);
            return null;
          }
        })
        .filter(Boolean)
        .slice(0, 40);

      renderNearbyStations(normalizedStations);
      renderMapMarkers(normalizedStations);
    } catch (error) {
      console.error("[BreatheSmart] Nearby stations failed", error);
      renderNearbyStations([]);
      renderMapMarkers([]);
      showError("Nearby stations could not be loaded, but the selected city's AQI may still be available.");
    }
  }

  async function fetchWAQI(path) {
    const token = getToken();

    if (!token) {
      throw new Error("Missing WAQI API token. Add it in config.js.");
    }

    const url = `${WAQI_BASE_URL}${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(function () {
      controller.abort();
    }, 12000);

    try {
      const response = await fetch(url, { signal: controller.signal });

      if (!response.ok) {
        throw new Error(`WAQI request failed with HTTP ${response.status}.`);
      }

      const payload = await response.json();

      if (payload?.status !== "ok") {
        const message = payload?.data || payload?.message || "WAQI returned a non-ok status.";
        throw new Error(String(message));
      }

      return payload;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  function getToken() {
    const token = window.CONFIG?.WAQI_TOKEN || (typeof CONFIG !== "undefined" ? CONFIG?.WAQI_TOKEN : "");

    if (!token || token === "YOUR_WAQI_API_TOKEN") {
      return "";
    }

    return token;
  }

  function normalizeStation(raw) {
    if (!raw || typeof raw !== "object") {
      return null;
    }

    const aqi = parseAQI(raw?.aqi);
    const cityName = raw?.city?.name || raw?.attributions?.[0]?.name || state.selectedCity || "Unknown station";
    const geo = Array.isArray(raw?.city?.geo) ? raw.city.geo : [];
    const lat = Number(geo?.[0]);
    const lon = Number(geo?.[1]);
    const iaqi = raw?.iaqi && typeof raw.iaqi === "object" ? raw.iaqi : {};

    return {
      uid: raw?.idx || raw?.city?.url || cityName,
      name: cityName,
      aqi,
      level: getAQILevel(aqi),
      lat: Number.isFinite(lat) ? lat : DEFAULT_COORDS[0],
      lon: Number.isFinite(lon) ? lon : DEFAULT_COORDS[1],
      time: raw?.time?.s || raw?.time?.iso || "Time unavailable",
      url: raw?.city?.url || "",
      pollutants: normalizePollutants(iaqi),
      raw
    };
  }

  function normalizeMapStation(raw) {
    if (!raw || typeof raw !== "object") {
      return null;
    }

    const lat = Number(raw?.lat);
    const lon = Number(raw?.lon);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return null;
    }

    const aqi = parseAQI(raw?.aqi);
    const name = raw?.station?.name || raw?.name || "Unnamed station";

    return {
      uid: raw?.uid || `${name}-${lat}-${lon}`,
      name,
      aqi,
      level: getAQILevel(aqi),
      lat,
      lon,
      time: raw?.station?.time || "Time unavailable",
      url: raw?.station?.url || "",
      pollutants: {},
      raw
    };
  }

  function normalizePollutants(iaqi) {
    return Object.keys(POLLUTANT_LABELS).reduce(function (acc, key) {
      const value = iaqi?.[key]?.v;
      acc[key] = Number.isFinite(Number(value)) ? Number(value) : null;
      return acc;
    }, {});
  }

  function parseAQI(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
  }

  function getAQILevel(aqi) {
    if (!Number.isFinite(aqi)) {
      return {
        key: "unknown",
        label: "Unknown",
        color: "#6b7b83",
        tip: "AQI data is unavailable for this station. Try another station or city."
      };
    }

    return AQI_LEVELS.find(function (level) {
      return aqi <= level.max;
    }) || AQI_LEVELS[AQI_LEVELS.length - 1];
  }

  function updateSidebar(station) {
    if (!station) {
      return;
    }

    const level = station.level || getAQILevel(station.aqi);

    setText(els.cityName, station.name || "Unknown station");
    setText(els.lastUpdated, station.time ? `Updated ${station.time}` : "Update time unavailable");
    setText(els.aqiNumber, Number.isFinite(station.aqi) ? station.aqi : "--");
    setText(els.aqiLabel, level.label || "Unknown");
    setText(els.healthTip, level.tip || "AQI guidance is unavailable for this station.");

    updateAQIBadge(level.key);
    updateScaleMarker(station.aqi);
    renderPollutants(station.pollutants);
  }

  function updateSelectedStation(station) {
    if (!station) {
      return;
    }

    state.lastStation = station;
    state.selectedCoords = [station.lat, station.lon];

    if (state.map && Number.isFinite(station.lat) && Number.isFinite(station.lon)) {
      state.map.setView([station.lat, station.lon], 11);
    }
  }

  function updateAQIBadge(levelKey) {
    if (!els.aqiLabel) {
      return;
    }

    els.aqiLabel.className = "aqi-badge";

    if (levelKey && levelKey !== "unknown") {
      els.aqiLabel.classList.add(levelKey);
    }
  }

  function updateScaleMarker(aqi) {
    if (!els.scaleMarker) {
      return;
    }

    const value = Number.isFinite(aqi) ? Math.min(aqi, MAX_AQI_FOR_SCALE) : 0;
    const percent = Math.max(0, Math.min(100, (value / MAX_AQI_FOR_SCALE) * 100));
    els.scaleMarker.style.left = `${percent}%`;
  }

  function renderPollutants(pollutants) {
    if (!els.pollutantsGrid) {
      return;
    }

    const safePollutants = pollutants || {};
    const html = Object.keys(POLLUTANT_LABELS).map(function (key) {
      const value = safePollutants?.[key];
      const displayValue = Number.isFinite(value) ? value : "--";

      return `
        <article class="pollutant-tile">
          <span>${escapeHTML(POLLUTANT_LABELS[key])}</span>
          <strong>${escapeHTML(String(displayValue))}</strong>
        </article>
      `;
    }).join("");

    els.pollutantsGrid.innerHTML = html;
  }

  function renderNearbyStations(stations) {
    const safeStations = Array.isArray(stations) ? stations : [];

    setText(els.stationCount, `${safeStations.length} found`);

    if (!els.stationsList) {
      return;
    }

    if (!safeStations.length) {
      els.stationsList.innerHTML = `<li class="empty-state">No nearby stations available.</li>`;
      return;
    }

    const fragment = document.createDocumentFragment();

    safeStations.forEach(function (station) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.className = "station-item";
      button.type = "button";
      button.innerHTML = `
        <span class="station-row">
          <span class="station-name">${escapeHTML(station.name)}</span>
          <span class="station-aqi">${Number.isFinite(station.aqi) ? station.aqi : "--"}</span>
        </span>
        <span class="station-meta">${escapeHTML(station.level?.label || "Unknown")} · ${escapeHTML(station.time || "Time unavailable")}</span>
      `;
      button.addEventListener("click", function () {
        focusStation(station);
      });
      item.appendChild(button);
      fragment.appendChild(item);
    });

    els.stationsList.replaceChildren(fragment);
  }

  function renderMapMarkers(stations) {
    if (!state.map || !state.markersLayer) {
      return;
    }

    state.markersLayer.clearLayers();

    if (state.lastStation) {
      addMarker(state.lastStation, true);
    }

    const safeStations = Array.isArray(stations) ? stations : [];
    safeStations.forEach(function (station) {
      try {
        addMarker(station, false);
      } catch (error) {
        console.warn("[BreatheSmart] Marker skipped", station, error);
      }
    });
  }

  function addMarker(station, isSelected) {
    if (!station || !Number.isFinite(station.lat) || !Number.isFinite(station.lon) || !state.markersLayer) {
      return;
    }

    const level = station.level || getAQILevel(station.aqi);
    const icon = L.divIcon({
      className: "",
      html: `<span class="aqi-marker ${escapeHTML(level.key)}">${Number.isFinite(station.aqi) ? station.aqi : "--"}</span>`,
      iconSize: isSelected ? [48, 48] : [42, 42],
      iconAnchor: [21, 21]
    });

    const marker = L.marker([station.lat, station.lon], { icon });
    marker.on("click", function () {
      focusStation(station);
    });
    marker.addTo(state.markersLayer);
  }

  function focusStation(station) {
    if (!station) {
      return;
    }

    if (state.map && Number.isFinite(station.lat) && Number.isFinite(station.lon)) {
      state.map.setView([station.lat, station.lon], 13);
    }

    openStationModal(station);
  }

  function openStationModal(station) {
    if (!station || !els.modal || !els.modalTitle || !els.modalBody) {
      return;
    }

    setText(els.modalTitle, station.name || "Station");

    const pollutants = station.pollutants || {};
    const pollutantMarkup = Object.keys(POLLUTANT_LABELS).map(function (key) {
      const value = pollutants?.[key];
      return `
        <div class="detail-item">
          <span>${escapeHTML(POLLUTANT_LABELS[key])}</span>
          <strong>${Number.isFinite(value) ? escapeHTML(String(value)) : "--"}</strong>
        </div>
      `;
    }).join("");

    els.modalBody.innerHTML = `
      <div class="detail-grid">
        <div class="detail-item">
          <span>AQI</span>
          <strong>${Number.isFinite(station.aqi) ? station.aqi : "--"}</strong>
        </div>
        <div class="detail-item">
          <span>Status</span>
          <strong>${escapeHTML(station.level?.label || "Unknown")}</strong>
        </div>
        <div class="detail-item">
          <span>Latitude</span>
          <strong>${Number.isFinite(station.lat) ? station.lat.toFixed(4) : "--"}</strong>
        </div>
        <div class="detail-item">
          <span>Longitude</span>
          <strong>${Number.isFinite(station.lon) ? station.lon.toFixed(4) : "--"}</strong>
        </div>
      </div>
      <div class="detail-item">
        <span>Last update</span>
        <strong>${escapeHTML(station.time || "Time unavailable")}</strong>
      </div>
      <div class="detail-grid">${pollutantMarkup}</div>
    `;

    if (typeof els.modal.showModal === "function") {
      els.modal.showModal();
    } else {
      els.modal.setAttribute("open", "open");
    }
  }

  function closeStationModal() {
    if (!els.modal) {
      return;
    }

    if (typeof els.modal.close === "function") {
      els.modal.close();
    } else {
      els.modal.removeAttribute("open");
    }
  }

  function resetMapView() {
    if (!state.map) {
      return;
    }

    state.map.setView(state.selectedCoords || DEFAULT_COORDS, 11);
  }

  function showFallbackUI(city) {
    const fallbackStation = {
      name: city || DEFAULT_CITY,
      aqi: null,
      level: getAQILevel(null),
      lat: state.selectedCoords?.[0] || DEFAULT_COORDS[0],
      lon: state.selectedCoords?.[1] || DEFAULT_COORDS[1],
      time: "Live data unavailable",
      pollutants: {}
    };

    updateSidebar(fallbackStation);
    renderNearbyStations([]);
    renderMapMarkers([]);
  }

  function setLoading(isLoading, message) {
    state.isLoading = Boolean(isLoading);

    if (els.loadingMessage && message) {
      setText(els.loadingMessage, message);
    }

    els.loadingOverlay?.classList.toggle("is-visible", state.isLoading);
    els.loadingOverlay?.setAttribute("aria-hidden", state.isLoading ? "false" : "true");
  }

  function setControlState(isDisabled) {
    [els.searchButton, els.locationButton, els.mapResetButton].forEach(function (control) {
      if (control) {
        control.disabled = Boolean(isDisabled);
      }
    });
  }

  function showError(message) {
    if (els.errorMessage) {
      setText(els.errorMessage, message || "Something went wrong.");
    }

    els.errorOverlay?.classList.add("is-visible");
    els.errorOverlay?.setAttribute("aria-hidden", "false");
  }

  function hideError() {
    els.errorOverlay?.classList.remove("is-visible");
    els.errorOverlay?.setAttribute("aria-hidden", "true");
  }

  function setLiveStatus(message, mode) {
    setText(els.liveStatusText, message || "Status unavailable");

    if (!els.liveStatus) {
      return;
    }

    els.liveStatus.classList.remove("is-live", "is-error");

    if (mode === "live") {
      els.liveStatus.classList.add("is-live");
    }

    if (mode === "error") {
      els.liveStatus.classList.add("is-error");
    }
  }

  function setText(element, value) {
    if (element) {
      element.textContent = value ?? "";
    }
  }

  function escapeHTML(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
})();
