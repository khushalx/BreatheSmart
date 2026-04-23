/* global L */

(function () {
  "use strict";

  const DEFAULT_CITY = "Delhi";
  const DEFAULT_COORDS = [28.6139, 77.2090];
  const GEOCODING_BASE_URL = "https://geocoding-api.open-meteo.com/v1/search";
  const AIR_QUALITY_BASE_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";
  const MAX_AQI_FOR_SCALE = 300;
  const REQUEST_TIMEOUT_MS = 12000;

  const CURRENT_FIELDS = [
    "us_aqi",
    "pm2_5",
    "pm10",
    "carbon_monoxide",
    "nitrogen_dioxide",
    "sulphur_dioxide",
    "ozone"
  ];

  const SAMPLE_OFFSETS = [
    { key: "center", label: "Center", lat: 0, lon: 0 },
    { key: "north", label: "North sample", lat: 0.18, lon: 0 },
    { key: "south", label: "South sample", lat: -0.18, lon: 0 },
    { key: "east", label: "East sample", lat: 0, lon: 0.18 },
    { key: "west", label: "West sample", lat: 0, lon: -0.18 }
  ];

  const AQI_LEVELS = [
    {
      max: 50,
      key: "good",
      label: "Good",
      tip: "Air quality is good. It is a comfortable time for outdoor plans."
    },
    {
      max: 100,
      key: "moderate",
      label: "Moderate",
      tip: "Air quality is acceptable. Sensitive groups may prefer shorter outdoor activity."
    },
    {
      max: 150,
      key: "unhealthy-sensitive",
      label: "Unhealthy for Sensitive Groups",
      tip: "Children, older adults, and people with breathing concerns should reduce prolonged exertion."
    },
    {
      max: 200,
      key: "unhealthy",
      label: "Unhealthy",
      tip: "Limit outdoor activity. Consider a mask outdoors and keep windows closed near traffic."
    },
    {
      max: 300,
      key: "very-unhealthy",
      label: "Very Unhealthy",
      tip: "Avoid outdoor exertion. Run air purification indoors if available."
    },
    {
      max: Infinity,
      key: "hazardous",
      label: "Hazardous",
      tip: "Stay indoors and avoid physical exertion. Follow local health guidance."
    }
  ];

  const POLLUTANT_LABELS = {
    pm2_5: "PM2.5",
    pm10: "PM10",
    carbon_monoxide: "CO",
    nitrogen_dioxide: "NO2",
    sulphur_dioxide: "SO2",
    ozone: "O3"
  };

  const state = {
    map: null,
    markersLayer: null,
    selectedCoords: DEFAULT_COORDS,
    selectedPlaceName: DEFAULT_CITY,
    mainPoint: null,
    nearbySamples: [],
    isLoading: false
  };

  const els = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    cacheElements();
    bindEvents();
    initMap();
    updateOpenMeteoLabels();
    console.log("[BreatheSmart] Open-Meteo dashboard initialized", window.CONFIG || {});
    searchCity(DEFAULT_CITY);
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
    els.pollutantsSource = document.querySelector("#pollutants-source");
    els.stationCount = document.querySelector("#station-count");
    els.stationsTitle = document.querySelector("#stations-title");
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
    els.modalClose?.addEventListener("click", closeModal);

    els.modal?.addEventListener("click", function (event) {
      if (event?.target === els.modal) {
        closeModal();
      }
    });
  }

  function updateOpenMeteoLabels() {
    setText(els.pollutantsSource, "Open-Meteo grid");
    setText(els.stationsTitle, "Nearby AQI Samples");

    const emptyItem = els.stationsList?.querySelector?.(".empty-state");
    setText(emptyItem, "Nearby sampled AQI points will load with the map.");
  }

  function initMap() {
    const mapElement = document.querySelector("#map");

    if (!mapElement || typeof L === "undefined") {
      console.error("[BreatheSmart] Leaflet unavailable or #map missing");
      showError("Map library could not load. AQI details can still appear in the sidebar.");
      return;
    }

    try {
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
    } catch (error) {
      console.error("[BreatheSmart] Map initialization failed", error);
      showError("The map could not be initialized, but AQI details may still load.");
    }
  }

  async function handleSearchSubmit(event) {
    event?.preventDefault?.();
    const city = els.searchInput?.value?.trim();

    if (!city) {
      showError("Please enter a city name before searching.");
      return;
    }

    await searchCity(city);
  }

  async function searchCity(cityName) {
    const safeCity = cityName?.trim?.() || DEFAULT_CITY;
    console.log("[BreatheSmart] Searching city with Open-Meteo geocoding", safeCity);
    showLoading(true, `Searching ${safeCity}...`);
    setControlState(true);

    try {
      const place = await geocodeCity(safeCity);

      if (!place) {
        throw new Error(`No geocoding result found for "${safeCity}".`);
      }

      const point = await fetchAirQualityByCoords(place.latitude, place.longitude, {
        name: formatPlaceName(place),
        sampleLabel: "Center",
        sampleKey: "center",
        isMain: true
      });

      updateMainUI(point);
      updateSelectedPoint(point);
      await fetchNearbySamples(point);
      setLiveStatus("Open-Meteo live data loaded", "live");
    } catch (error) {
      console.error("[BreatheSmart] City search failed", error);
      showFallbackUI(safeCity);
      showError(error?.message || "Unable to load AQI for that city.");
      setLiveStatus("AQI unavailable", "error");
    } finally {
      showLoading(false);
      setControlState(false);
    }
  }

  async function geocodeCity(cityName) {
    const params = new URLSearchParams({
      name: cityName || DEFAULT_CITY,
      count: "1",
      language: "en",
      format: "json"
    });
    const payload = await fetchJSON(`${GEOCODING_BASE_URL}?${params.toString()}`, "geocoding");
    const result = Array.isArray(payload?.results) ? payload.results[0] : null;
    const latitude = Number(result?.latitude);
    const longitude = Number(result?.longitude);

    if (!result || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return null;
    }

    const updateTime = current?.time || (payload?.generationtime_ms ? "Recently updated" : "Time unavailable");

    return {
      ...result,
      latitude,
      longitude
    };
  }

  function handleLocationClick() {
    if (!navigator?.geolocation) {
      showError("Geolocation is not available in this browser.");
      return;
    }

    console.log("[BreatheSmart] Requesting browser location");
    showLoading(true, "Finding your location...");
    setControlState(true);

    navigator.geolocation.getCurrentPosition(
      async function (position) {
        const latitude = Number(position?.coords?.latitude);
        const longitude = Number(position?.coords?.longitude);

        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          console.error("[BreatheSmart] Browser returned invalid coordinates", position);
          showLoading(false);
          setControlState(false);
          showError("Your browser returned an invalid location.");
          return;
        }

        await loadLocationAQI(latitude, longitude, "My Location");
      },
      function (error) {
        console.error("[BreatheSmart] Geolocation failed", error);
        showLoading(false);
        setControlState(false);
        showError(error?.message || "Unable to access your location.");
        setLiveStatus("Location unavailable", "error");
      },
      {
        enableHighAccuracy: false,
        timeout: 10000,
        maximumAge: 300000
      }
    );
  }

  async function loadLocationAQI(latitude, longitude, label) {
    console.log("[BreatheSmart] Loading AQI for coordinates", { latitude, longitude });
    showLoading(true, "Loading AQI for your location...");

    try {
      const point = await fetchAirQualityByCoords(latitude, longitude, {
        name: label || "Selected location",
        sampleLabel: "Center",
        sampleKey: "center",
        isMain: true
      });

      updateMainUI(point);
      updateSelectedPoint(point);
      await fetchNearbySamples(point);
      setLiveStatus("Open-Meteo live data loaded", "live");
    } catch (error) {
      console.error("[BreatheSmart] Location AQI failed", error);
      showFallbackUI(label || "Your location");
      showError(error?.message || "Unable to load AQI for your location.");
      setLiveStatus("AQI unavailable", "error");
    } finally {
      showLoading(false);
      setControlState(false);
    }
  }

  async function fetchAirQualityByCoords(latitude, longitude, options) {
    const safeLat = Number(latitude);
    const safeLon = Number(longitude);

    if (!Number.isFinite(safeLat) || !Number.isFinite(safeLon)) {
      throw new Error("Invalid coordinates for air-quality request.");
    }

    const params = new URLSearchParams({
      latitude: String(safeLat),
      longitude: String(safeLon),
      current: CURRENT_FIELDS.join(","),
      timezone: "auto"
    });

    const payload = await fetchJSON(`${AIR_QUALITY_BASE_URL}?${params.toString()}`, "air-quality");
    return normalizeAirQualityPoint(payload, {
      latitude: safeLat,
      longitude: safeLon,
      name: options?.name || "AQI sample",
      sampleLabel: options?.sampleLabel || "Sample",
      sampleKey: options?.sampleKey || "sample",
      isMain: Boolean(options?.isMain)
    });
  }

  async function fetchNearbySamples(centerPoint) {
    if (!centerPoint || !Number.isFinite(centerPoint?.lat) || !Number.isFinite(centerPoint?.lon)) {
      console.error("[BreatheSmart] Nearby samples skipped: invalid center point", centerPoint);
      state.nearbySamples = [];
      renderNearbyList([]);
      renderMapMarkers();
      return;
    }

    console.log("[BreatheSmart] Fetching nearby sampled AQI points", centerPoint);

    const requests = SAMPLE_OFFSETS.map(function (offset) {
      const lat = centerPoint.lat + offset.lat;
      const lon = centerPoint.lon + offset.lon;
      const sampleName = offset.key === "center"
        ? `${centerPoint.name} center`
        : `${centerPoint.name} ${offset.label}`;

      return fetchAirQualityByCoords(lat, lon, {
        name: sampleName,
        sampleLabel: offset.label,
        sampleKey: offset.key,
        isMain: offset.key === "center"
      });
    });

    const settled = await Promise.allSettled(requests);
    const samples = [];

    settled.forEach(function (result, index) {
      try {
        if (result?.status === "fulfilled" && result?.value) {
          samples.push(result.value);
          return;
        }

        console.error("[BreatheSmart] Nearby sample failed", {
          sample: SAMPLE_OFFSETS[index]?.label || index,
          reason: result?.reason
        });
      } catch (error) {
        console.error("[BreatheSmart] Error while processing nearby sample result", error);
      }
    });

    state.nearbySamples = samples;
    renderNearbyList(samples);
    renderMapMarkers();
  }

  async function fetchJSON(url, context) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(function () {
      controller.abort();
    }, REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, { signal: controller.signal });

      if (!response?.ok) {
        throw new Error(`${context || "Request"} failed with HTTP ${response?.status || "unknown"}.`);
      }

      return await response.json();
    } catch (error) {
      if (error?.name === "AbortError") {
        console.error(`[BreatheSmart] ${context || "Request"} timed out`, { url });
        throw new Error("The air-quality request timed out. Please try again.");
      }

      console.error(`[BreatheSmart] ${context || "Request"} failed`, error);
      throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  function normalizeAirQualityPoint(payload, meta) {
    const current = payload?.current || {};
    const currentUnits = payload?.current_units || {};
    const aqi = parseNumber(current?.us_aqi);
    const pollutants = {};

    Object.keys(POLLUTANT_LABELS).forEach(function (key) {
      pollutants[key] = parseNumber(current?.[key]);
    });

    return {
      id: `${meta?.sampleKey || "sample"}-${meta?.latitude}-${meta?.longitude}`,
      name: meta?.name || "AQI sample",
      sampleLabel: meta?.sampleLabel || "Sample",
      sampleKey: meta?.sampleKey || "sample",
      isMain: Boolean(meta?.isMain),
      aqi,
      level: getAQILevel(aqi),
      lat: Number(meta?.latitude),
      lon: Number(meta?.longitude),
      time: updateTime,
      timezone: payload?.timezone || "Local timezone",
      pollutants,
      units: currentUnits,
      raw: payload || {}
    };
  }

  function updateMainUI(point) {
    if (!point) {
      return;
    }

    const level = point?.level || getAQILevel(point?.aqi);

    setText(els.cityName, point?.name || "Selected location");
    setText(els.lastUpdated, point?.time ? `Updated ${point.time}` : "Update time unavailable");
    setText(els.aqiNumber, Number.isFinite(point?.aqi) ? point.aqi : "--");
    setText(els.aqiLabel, level?.label || "Unknown");
    setText(els.healthTip, level?.tip || "AQI guidance is unavailable for this location.");

    updateAQIBadge(level?.key);
    updateScaleMarker(point?.aqi);
    renderPollutants(point?.pollutants, point?.units);
  }

  function updateSelectedPoint(point) {
    if (!point) {
      return;
    }

    state.mainPoint = point;
    state.selectedPlaceName = point?.name || DEFAULT_CITY;
    state.selectedCoords = [
      Number.isFinite(point?.lat) ? point.lat : DEFAULT_COORDS[0],
      Number.isFinite(point?.lon) ? point.lon : DEFAULT_COORDS[1]
    ];

    if (state.map && Number.isFinite(point?.lat) && Number.isFinite(point?.lon)) {
      try {
        state.map.setView([point.lat, point.lon], 11);
      } catch (error) {
        console.error("[BreatheSmart] Unable to move map to selected point", error);
      }
    }
  }

  function renderPollutants(pollutants, units) {
    if (!els.pollutantsGrid) {
      return;
    }

    try {
      const safePollutants = pollutants || {};
      const safeUnits = units || {};
      const html = Object.keys(POLLUTANT_LABELS).map(function (key) {
        const value = safePollutants?.[key];
        const unit = safeUnits?.[key] || "";
        const displayValue = Number.isFinite(value) ? formatNumber(value) : "--";
        const displayUnit = unit ? ` ${escapeHTML(unit)}` : "";

        return `
          <article class="pollutant-tile">
            <span>${escapeHTML(POLLUTANT_LABELS[key])}</span>
            <strong>${escapeHTML(displayValue)}${displayUnit}</strong>
          </article>
        `;
      }).join("");

      els.pollutantsGrid.innerHTML = html;
    } catch (error) {
      console.error("[BreatheSmart] Failed to render pollutants", error);
    }
  }

  function renderNearbyList(samples) {
    const safeSamples = Array.isArray(samples) ? samples : [];
    setText(els.stationCount, `${safeSamples.length} samples`);

    if (!els.stationsList) {
      return;
    }

    if (!safeSamples.length) {
      els.stationsList.innerHTML = `<li class="empty-state">No nearby sampled AQI points available.</li>`;
      return;
    }

    const fragment = document.createDocumentFragment();

    safeSamples.forEach(function (sample) {
      try {
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.className = "station-item";
        button.type = "button";
        button.innerHTML = `
          <span class="station-row">
            <span class="station-name">${escapeHTML(sample?.sampleLabel || sample?.name || "AQI sample")}</span>
            <span class="station-aqi">${Number.isFinite(sample?.aqi) ? sample.aqi : "--"}</span>
          </span>
          <span class="station-meta">${escapeHTML(sample?.level?.label || "Unknown")} - ${escapeHTML(formatCoords(sample?.lat, sample?.lon))}</span>
        `;
        button.addEventListener("click", function () {
          focusPoint(sample);
        });
        item.appendChild(button);
        fragment.appendChild(item);
      } catch (error) {
        console.error("[BreatheSmart] Failed to render one nearby sample", { sample, error });
      }
    });

    els.stationsList.replaceChildren(fragment);
  }

  function renderMapMarkers() {
    if (!state.map || !state.markersLayer || typeof L === "undefined") {
      return;
    }

    try {
      state.markersLayer.clearLayers();
    } catch (error) {
      console.error("[BreatheSmart] Could not clear map markers", error);
      return;
    }

    const points = [state.mainPoint].concat(state.nearbySamples || []).filter(Boolean);
    const seen = new Set();

    points.forEach(function (point) {
      try {
        const key = `${point?.sampleKey || "point"}:${point?.lat}:${point?.lon}`;
        if (seen.has(key)) {
          return;
        }
        seen.add(key);
        addMarker(point);
      } catch (error) {
        console.error("[BreatheSmart] Marker skipped", { point, error });
      }
    });
  }

  function addMarker(point) {
    if (!point || !Number.isFinite(point?.lat) || !Number.isFinite(point?.lon) || !state.markersLayer) {
      return;
    }

    const level = point?.level || getAQILevel(point?.aqi);
    const aqiText = Number.isFinite(point?.aqi) ? String(point.aqi) : "--";
    const iconSize = point?.isMain ? [48, 48] : [42, 42];
    const icon = L.divIcon({
      className: "",
      html: `<span class="aqi-marker ${escapeHTML(level?.key || "unknown")}">${escapeHTML(aqiText)}</span>`,
      iconSize,
      iconAnchor: [iconSize[0] / 2, iconSize[1] / 2]
    });

    const marker = L.marker([point.lat, point.lon], { icon });
    marker.on("click", function () {
      focusPoint(point);
    });
    marker.addTo(state.markersLayer);
  }

  function focusPoint(point) {
    if (!point) {
      return;
    }

    if (state.map && Number.isFinite(point?.lat) && Number.isFinite(point?.lon)) {
      try {
        state.map.setView([point.lat, point.lon], point?.isMain ? 11 : 12);
      } catch (error) {
        console.error("[BreatheSmart] Failed to focus map point", error);
      }
    }

    openModal(point);
  }

  function openModal(point) {
    if (!point || !els.modal || !els.modalTitle || !els.modalBody) {
      console.warn("[BreatheSmart] Modal unavailable; point details skipped", point);
      return;
    }

    try {
      setText(els.modalTitle, point?.name || "AQI sample");

      const pollutantMarkup = Object.keys(POLLUTANT_LABELS).map(function (key) {
        const value = point?.pollutants?.[key];
        const unit = point?.units?.[key] || "";
        const displayValue = Number.isFinite(value) ? formatNumber(value) : "--";
        const displayUnit = unit ? ` ${escapeHTML(unit)}` : "";

        return `
          <div class="detail-item">
            <span>${escapeHTML(POLLUTANT_LABELS[key])}</span>
            <strong>${escapeHTML(displayValue)}${displayUnit}</strong>
          </div>
        `;
      }).join("");

      els.modalBody.innerHTML = `
        <div class="detail-grid">
          <div class="detail-item">
            <span>US AQI</span>
            <strong>${Number.isFinite(point?.aqi) ? point.aqi : "--"}</strong>
          </div>
          <div class="detail-item">
            <span>Status</span>
            <strong>${escapeHTML(point?.level?.label || "Unknown")}</strong>
          </div>
          <div class="detail-item">
            <span>Latitude</span>
            <strong>${Number.isFinite(point?.lat) ? point.lat.toFixed(4) : "--"}</strong>
          </div>
          <div class="detail-item">
            <span>Longitude</span>
            <strong>${Number.isFinite(point?.lon) ? point.lon.toFixed(4) : "--"}</strong>
          </div>
        </div>
        <div class="detail-item">
          <span>Grid sample</span>
          <strong>${escapeHTML(point?.sampleLabel || "Selected point")}</strong>
        </div>
        <div class="detail-item">
          <span>Last update</span>
          <strong>${escapeHTML(point?.time || "Time unavailable")}</strong>
        </div>
        <div class="detail-grid">${pollutantMarkup}</div>
      `;

      if (typeof els.modal.showModal === "function") {
        els.modal.showModal();
      } else {
        els.modal.setAttribute("open", "open");
      }
    } catch (error) {
      console.error("[BreatheSmart] Failed to open modal", error);
    }
  }

  function closeModal() {
    if (!els.modal) {
      return;
    }

    try {
      if (typeof els.modal.close === "function") {
        els.modal.close();
      } else {
        els.modal.removeAttribute("open");
      }
    } catch (error) {
      console.error("[BreatheSmart] Failed to close modal", error);
    }
  }

  function resetMapView() {
    if (!state.map) {
      return;
    }

    const coords = Array.isArray(state.selectedCoords) ? state.selectedCoords : DEFAULT_COORDS;

    try {
      state.map.setView(coords, 11);
    } catch (error) {
      console.error("[BreatheSmart] Failed to reset map view", error);
    }
  }

  function showFallbackUI(label) {
    const fallbackPoint = {
      name: label || DEFAULT_CITY,
      sampleLabel: "Fallback",
      sampleKey: "fallback",
      isMain: true,
      aqi: null,
      level: getAQILevel(null),
      lat: state.selectedCoords?.[0] || DEFAULT_COORDS[0],
      lon: state.selectedCoords?.[1] || DEFAULT_COORDS[1],
      time: "Live data unavailable",
      pollutants: {},
      units: {}
    };

    updateMainUI(fallbackPoint);
    state.mainPoint = fallbackPoint;
    state.nearbySamples = [];
    renderNearbyList([]);
    renderMapMarkers();
  }

  function getAQILevel(aqi) {
    if (!Number.isFinite(aqi)) {
      return {
        key: "unknown",
        label: "Unknown",
        tip: "AQI data is unavailable for this location. Try another city or sample point."
      };
    }

    return AQI_LEVELS.find(function (level) {
      return aqi <= level.max;
    }) || AQI_LEVELS[AQI_LEVELS.length - 1];
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

    const value = Number.isFinite(aqi) ? Math.min(Math.max(aqi, 0), MAX_AQI_FOR_SCALE) : 0;
    const percent = Math.max(0, Math.min(100, (value / MAX_AQI_FOR_SCALE) * 100));
    els.scaleMarker.style.left = `${percent}%`;
  }

  function showLoading(isVisible, message) {
    state.isLoading = Boolean(isVisible);

    if (message) {
      setText(els.loadingMessage, message);
    }

    els.loadingOverlay?.classList.toggle("is-visible", state.isLoading);
    els.loadingOverlay?.setAttribute("aria-hidden", state.isLoading ? "false" : "true");
  }

  function showError(message) {
    setText(els.errorMessage, message || "Something went wrong while loading AQI data.");
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

  function setControlState(isDisabled) {
    [els.searchButton, els.locationButton, els.mapResetButton].forEach(function (control) {
      if (control) {
        control.disabled = Boolean(isDisabled);
      }
    });
  }

  function parseNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function formatNumber(value) {
    if (!Number.isFinite(value)) {
      return "--";
    }

    return Math.abs(value) >= 100 ? String(Math.round(value)) : value.toFixed(1);
  }

  function formatPlaceName(place) {
    const parts = [
      place?.name,
      place?.admin1,
      place?.country
    ].filter(Boolean);

    return parts.length ? parts.join(", ") : DEFAULT_CITY;
  }

  function formatCoords(latitude, longitude) {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return "Coordinates unavailable";
    }

    return `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`;
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
