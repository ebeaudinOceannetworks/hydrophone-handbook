(function () {
  const API_BASE = "https://data.oceannetworks.ca/api";
  const TOKEN_PLACEHOLDER = "YOUR_TOKEN";

  const ARCHIVE_ORDER = ["flac", "wav", "fft", "mat", "png", "oct", "hyd", "txt"];
  const ARCHIVE_BY_FAMILY = {
    "ocean-sonics": [
      { value: "flac", label: "flac — lossless audio" },
      { value: "wav", label: "wav — uncompressed audio (older)" },
      { value: "fft", label: "fft — Ocean Sonics spectral" },
      { value: "mat", label: "mat — calibrated spectral data (1-min averaged)" },
      { value: "png", label: "png — spectrogram" },
      { value: "txt", label: "txt — logs / auxiliary data" }
    ],
    jasco: [
      { value: "flac", label: "flac — lossless audio" },
      { value: "wav", label: "wav — uncompressed audio" },
      { value: "oct", label: "oct — 1/3-octave spectral" },
      { value: "mat", label: "mat — calibrated spectral data (1-min averaged)" },
      { value: "png", label: "png — spectrogram" },
      { value: "txt", label: "txt — logs / auxiliary data" }
    ],
    ios: [
      { value: "hyd", label: "hyd — array raw (retired IOS)" },
      { value: "wav", label: "wav — uncompressed audio" },
      { value: "txt", label: "txt — logs / auxiliary data" }
    ],
    other: [
      { value: "flac", label: "flac — lossless audio" },
      { value: "wav", label: "wav — uncompressed audio" },
      { value: "txt", label: "txt — logs / auxiliary data" }
    ]
  };

  function deviceFamily(deviceCode) {
    const code = String(deviceCode || "").toUpperCase();
    if (code.indexOf("IOS3HYD") === 0) return "ios";
    if (code.indexOf("JASCO") === 0 || code.indexOf("NAXYS") === 0) return "jasco";
    if (code.indexOf("ICLISTEN") === 0 || code.indexOf("ICHYDROPHONE") === 0 || code.indexOf("SONGMETER") === 0) {
      return "ocean-sonics";
    }
    return "other";
  }

  function parseTime(value) {
    if (!value) return null;
    const ms = Date.parse(value);
    return isNaN(ms) ? null : ms;
  }

  function deploymentOverlaps(dep, dateFrom, dateTo) {
    const begin = parseTime(dep.begin) || 0;
    const end = parseTime(dep.end);
    const from = parseTime(dateFrom);
    const to = parseTime(dateTo);
    if (from != null && end != null && end <= from) return false;
    if (to != null && begin >= to) return false;
    return true;
  }

  function familiesForSelection(catalog) {
    const lookup = (document.querySelector('input[name="api-lookup"]:checked') || {}).value || "location";
    const locationCode = (($("api-location") || {}).value || "").trim();
    const deviceCode = (($("api-device") || {}).value || "").trim();
    const dateFrom = toOncIso(($("api-date-from") || {}).value);
    const dateTo = toOncIso(($("api-date-to") || {}).value);
    function matchesSelection(dep, useDates) {
      if (lookup === "device") {
        if (!deviceCode || dep.deviceCode !== deviceCode) return false;
      } else if (!locationCode || dep.locationCode !== locationCode) {
        return false;
      }
      return !useDates || deploymentOverlaps(dep, dateFrom, dateTo);
    }
    let usedDates = true;
    let matches = (catalog.deployments || []).filter(function (dep) {
      return matchesSelection(dep, true);
    });
    if (!matches.length) {
      usedDates = false;
      matches = (catalog.deployments || []).filter(function (dep) {
        return matchesSelection(dep, false);
      });
    }
    const families = [];
    matches.forEach(function (dep) {
      const family = deviceFamily(dep.deviceCode);
      if (families.indexOf(family) === -1) families.push(family);
    });
    if (!families.length) {
      if (lookup === "device" && deviceCode) families.push(deviceFamily(deviceCode));
      else families.push("ocean-sonics");
    }
    return { families: families, usedDates: usedDates };
  }

  function archiveExtensions(catalog) {
    const seen = {};
    familiesForSelection(catalog).families.forEach(function (family) {
      (ARCHIVE_BY_FAMILY[family] || ARCHIVE_BY_FAMILY.other).forEach(function (item) {
        seen[item.value] = item;
      });
    });
    return ARCHIVE_ORDER.filter(function (ext) { return seen[ext]; }).map(function (ext) {
      return seen[ext];
    });
  }

  function syncArchiveExtensions(catalog) {
    const sel = $("api-archive-ext");
    if (!sel) return;
    const options = archiveExtensions(catalog);
    const current = sel.value;
    sel.innerHTML = options.map(function (item) {
      return "<option value='" + escapeHtml(item.value) + "'>" + escapeHtml(item.label) + "</option>";
    }).join("");
    const keep = options.some(function (item) { return item.value === current; });
    sel.value = keep ? current : (options[0] ? options[0].value : "flac");
    const hint = $("api-archive-hint");
    if (hint) {
      const info = familiesForSelection(catalog);
      const base = "The list covers what this instrument can produce, not what exists in this exact window. " +
        "If a download comes back empty, list the files first.";
      if (info.families.indexOf("ios") === -1) {
        hint.textContent = base;
      } else if (info.usedDates) {
        hint.textContent = "This time range covers a retired IOS array, so .hyd is offered. " + base;
      } else {
        hint.textContent = "This location hosted a retired IOS array (.hyd), possibly outside the dates you picked. " + base;
      }
    }
  }

  function $(id) {
    return document.getElementById(id);
  }

  function catalogEl() {
    return document.getElementById("onc-hydro-catalog");
  }

  function loadCatalog() {
    const el = catalogEl();
    if (!el) return { locations: [], devices: [], deployments: [], products: [] };
    try {
      return JSON.parse(el.textContent);
    } catch (err) {
      console.warn("Could not parse hydrophone catalog", err);
      return { locations: [], devices: [], deployments: [], products: [] };
    }
  }

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  // YYYY-MM-DD HH:MM[:SS], 24-hour, always read as UTC. A "T" separator is
  // accepted so timestamps can be pasted straight from filenames or the API.
  const UTC_INPUT = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?Z?$/;

  function toUtcInput(date) {
    return (
      date.getUTCFullYear() +
      "-" + pad(date.getUTCMonth() + 1) +
      "-" + pad(date.getUTCDate()) +
      " " + pad(date.getUTCHours()) +
      ":" + pad(date.getUTCMinutes())
    );
  }

  function toOncIso(value) {
    const m = UTC_INPUT.exec(String(value == null ? "" : value).trim());
    if (!m) return "";
    const year = +m[1], month = +m[2], day = +m[3];
    const hour = +m[4], minute = +m[5], second = +(m[6] || 0);
    if (month < 1 || month > 12 || day < 1 || day > 31) return "";
    if (hour > 23 || minute > 59 || second > 59) return "";
    const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    // Rejects dates that rolled over, e.g. 2023-02-30.
    if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
    return date.toISOString().replace(/\.\d{3}Z$/, ".000Z");
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function uniqueBy(items, keyFn) {
    const seen = new Map();
    items.forEach(function (item) {
      const key = keyFn(item);
      if (!seen.has(key)) seen.set(key, item);
    });
    return Array.from(seen.values());
  }

  function fillDatalist(listId, items) {
    const list = $(listId);
    if (!list) return;
    list.innerHTML = items.map(function (item) {
      return '<option value="' + escapeHtml(item.value) + '">' +
        escapeHtml(item.label) + "</option>";
    }).join("");
  }

  // SHV is generated for the Hydrophone Viewer and is not orderable through
  // dataProductDelivery, so it is deliberately absent here.
  const PRODUCT_ORDER = ["AD", "HSD", "HSPD", "LF", "HCF", "HACC", "HARD", "TSSD"];
  const PRODUCT_LABELS = {
    AD: "AD — Audio Data",
    HSD: "HSD — Hydrophone Spectral Data",
    HSPD: "HSPD — Spectral Probability Density",
    LF: "LF — log / auxiliary file",
    HCF: "HCF — calibration files",
    HACC: "HACC — acceleration (ancillary)",
    HARD: "HARD — array raw (retired IOS)",
    TSSD: "TSSD — ancillary scalar (humidity, temperature, battery)"
  };
  const PRODUCT_FAMILIES = {
    AD: null,
    HSD: null,
    HSPD: null,
    LF: ["ocean-sonics", "other"],
    HCF: null,
    HACC: ["ocean-sonics"],
    HARD: ["ios"],
    TSSD: ["ocean-sonics", "other"]
  };
  // Extensions the catalog advertises for the whole HYDROPHONE category but
  // that no hydrophone actually delivers as a data product (.oct is archive-only).
  const ORDER_EXCLUDED_FORMATS = ["oct"];
  const FORMAT_FAMILIES = {
    fft: ["ocean-sonics"],
    hyd: ["ios"]
  };

  function productByCode(catalog, code) {
    return (catalog.products || []).find(function (p) { return p.code === code; });
  }

  function productsForSelection(catalog) {
    const families = familiesForSelection(catalog).families;
    return PRODUCT_ORDER.filter(function (code) {
      if (!(catalog.products || []).some(function (p) { return p.code === code; })) return false;
      const allowed = PRODUCT_FAMILIES[code];
      return !allowed || families.some(function (family) { return allowed.indexOf(family) !== -1; });
    }).map(function (code) {
      const product = productByCode(catalog, code);
      return {
        code: code,
        name: PRODUCT_LABELS[code] || (product.code + " — " + product.name),
        product: product
      };
    });
  }

  function formatsForSelection(catalog, product) {
    const families = familiesForSelection(catalog).families;
    const formats = (product && product.formats) || [];
    return formats.filter(function (f) {
      if (ORDER_EXCLUDED_FORMATS.indexOf(f.extension) !== -1) return false;
      const allowed = FORMAT_FAMILIES[f.extension];
      return !allowed || families.some(function (family) { return allowed.indexOf(family) !== -1; });
    });
  }

  function syncProducts(catalog) {
    const sel = $("api-product");
    if (!sel) return;
    const options = productsForSelection(catalog);
    const current = sel.value;
    sel.innerHTML = options.map(function (item) {
      return "<option value='" + escapeHtml(item.code) + "'>" + escapeHtml(item.name) + "</option>";
    }).join("");
    const keep = options.some(function (item) { return item.code === current; });
    sel.value = keep ? current : (options[0] ? options[0].code : "AD");
    const hint = $("api-product-hint");
    if (hint) {
      const families = familiesForSelection(catalog).families;
      const base = "AD is the acoustic data; HSD and HSPD are spectral. HACC and TSSD are ancillary " +
        "instrument readings, not sound.";
      hint.textContent = families.indexOf("ios") === -1
        ? base
        : "This selection covers a retired IOS array, so HARD (.hyd) is offered as the raw product. " + base;
    }
    syncProductFormats(catalog);
  }

  function formatForProduct(product, extension) {
    if (!product) return null;
    return (product.formats || []).find(function (f) { return f.extension === extension; }) ||
      (product.formats || [])[0] ||
      null;
  }

  function currentState(catalog) {
    const lookup = (document.querySelector('input[name="api-lookup"]:checked') || {}).value || "location";
    const method = (document.querySelector('input[name="api-method"]:checked') || {}).value || "archive";
    const archiveAction = ($("api-archive-action") || {}).value || "download";
    const locationCode = ($("api-location") || {}).value.trim();
    const deviceCode = ($("api-device") || {}).value.trim();
    const dateFrom = toOncIso(($("api-date-from") || {}).value);
    const dateTo = toOncIso(($("api-date-to") || {}).value);
    const token = (($("api-token") || {}).value || "").trim() || TOKEN_PLACEHOLDER;
    const productCode = ($("api-product") || {}).value;
    const orderExt = ($("api-order-ext") || {}).value;
    const archiveExt = ($("api-archive-ext") || {}).value;
    const includeMeta = ($("api-include-meta") || {}).checked;

    const product = productByCode(catalog, productCode);
    const format = formatForProduct(product, orderExt);
    // Only send options the user actually changed. Some devices reject the
    // catalog-wide default (IOS arrays only accept dpo_audioFormatConversion=1),
    // and Oceans 3.0 applies the per-device default for anything omitted.
    const dpos = {};
    if (method === "order" && format) {
      (format.options || []).forEach(function (opt) {
        const input = document.querySelector('[data-dpo="' + opt.option + '"]');
        if (!input) return;
        const value = input.value;
        if (value === "" || value == null) return;
        const fallback = opt.defaultValue == null ? "" : String(opt.defaultValue);
        if (value === fallback) return;
        dpos[opt.option] = value;
      });
    }

    return {
      lookup: lookup,
      method: method,
      archiveAction: archiveAction,
      locationCode: locationCode,
      deviceCode: deviceCode,
      dateFrom: dateFrom,
      dateTo: dateTo,
      token: token,
      productCode: productCode,
      productName: product ? product.name : "",
      extension: method === "archive" ? archiveExt : orderExt,
      includeMeta: includeMeta,
      dpos: dpos
    };
  }

  function filters(state) {
    const params = {};
    if (state.lookup === "device") {
      params.deviceCode = state.deviceCode || "ICLISTENHF6016";
    } else {
      params.locationCode = state.locationCode || "CQSH.H1";
      params.deviceCategoryCode = "HYDROPHONE";
    }
    if (state.dateFrom) params.dateFrom = state.dateFrom;
    if (state.dateTo) params.dateTo = state.dateTo;
    if (state.method === "order") {
      if (state.extension) params.extension = state.extension;
      params.dataProductCode = state.productCode || "AD";
      Object.keys(state.dpos).forEach(function (key) {
        params[key] = state.dpos[key];
      });
    } else if (state.extension) {
      // /archivefile/* names this filter fileExtension; "extension" is rejected.
      params.fileExtension = state.extension;
    }
    return params;
  }

  function pyString(value) {
    return JSON.stringify(String(value));
  }

  function pyParams(params) {
    const keys = Object.keys(params);
    const lines = keys.map(function (key, i) {
      const comma = i < keys.length - 1 ? "," : "";
      return "    " + pyString(key) + ": " + pyString(params[key]) + comma;
    });
    return "{\n" + lines.join("\n") + "\n}";
  }

  function matlabParams(params) {
    const keys = Object.keys(params);
    const lines = keys.map(function (key, i) {
      const comma = i < keys.length - 1 ? ", ..." : "";
      return "    '" + key + "', '" + String(params[key]).replace(/'/g, "''") + "'" + comma;
    });
    return "struct( ...\n" + lines.join("\n") + ")";
  }

  function queryString(params, token) {
    const all = Object.assign({ token: token }, params);
    return Object.keys(all).map(function (key) {
      return encodeURIComponent(key) + "=" + encodeURIComponent(all[key]);
    }).join("&");
  }

  function restPath(state) {
    if (state.method === "order") return "/dataProductDelivery/request";
    return state.lookup === "device" ? "/archivefile/device" : "/archivefile/location";
  }

  function pythonCode(state, params) {
    const lines = [
      "from onc import ONC",
      "",
      "onc = ONC(" + pyString(state.token) + ")",
      "params = " + pyParams(params)
    ];
    if (state.method === "archive") {
      if (state.archiveAction === "list") {
        lines.push("result = onc.getArchivefile(params, allPages=True)");
      } else {
        lines.push("result = onc.downloadDirectArchivefile(params)");
      }
    } else {
      lines.push(
        "result = onc.orderDataProduct(params, includeMetadataFile=" +
        (state.includeMeta ? "True" : "False") + ")"
      );
    }
    return lines.join("\n");
  }

  function matlabCode(state, params) {
    const token = state.token.replace(/'/g, "''");
    const lines = [
      "onc = Onc('" + token + "');",
      "params = " + matlabParams(params) + ";"
    ];
    if (state.method === "archive") {
      if (state.lookup === "device") {
        lines.push(state.archiveAction === "list"
          ? "result = onc.getListByDevice(params);"
          : "result = onc.getDirectFiles(params);");
      } else {
        lines.push(state.archiveAction === "list"
          ? "result = onc.getListByLocation(params);"
          : "result = onc.getDirectFiles(params);");
      }
    } else {
      // Signature: orderDataProduct(filters, maxRetries, downloadResultsOnly, includeMetadataFile)
      lines.push(state.includeMeta
        ? "result = onc.orderDataProduct(params);"
        : "result = onc.orderDataProduct(params, 0, false, false);");
    }
    return lines.join("\n");
  }

  function curlCode(state, params) {
    const url = API_BASE + restPath(state) + "?" + queryString(params, state.token);
    const lines = [
      "curl -L \\" ,
      "  \"" + url + "\""
    ];
    if (state.method === "order") {
      lines.push("");
      lines.push("# This only places the order and returns a dpRequestId. Then:");
      lines.push("#   GET " + API_BASE + "/dataProductDelivery/run?dpRequestId=<id>&token=" + state.token);
      lines.push("#   GET " + API_BASE + "/dataProductDelivery/download?dpRunId=<id>&index=1&token=" + state.token);
      if (state.includeMeta) {
        lines.push("# The metadata file is served at index=meta.");
      }
    } else {
      lines.push("");
      lines.push("# curl can only list archive files. To download one of them:");
      lines.push("# curl -L -O -J \"" + API_BASE + "/archivefile/download?filename=<filename>&token=" + state.token + "\"");
    }
    return lines.join("\n");
  }

  const DPO_HELP = {
    dpo_audioDownsample: "Output sample rate in Hz. −1 keeps the hydrophone’s sampling rate.",
    dpo_audioFormatConversion: "Whether to convert the archived audio format (0 = keep as archived, 1 = convert).",
    dpo_hydrophoneAcquisitionMode: "Duty-cycle filter. LF is the low sample-rate segments (~16 kHz), HF is the high-rate segments (≥128 kHz), All returns both.",
    dpo_hydrophoneChannel: "Channel on a multi-hydrophone array file (H1, H2, H3, or All).",
    dpo_hydrophoneDataDiversionMode: "OD is original (non-diverted) data. LPF/HPF are filtered diverted files. All includes overlapping diverted and original files.",
    dpo_spectrogramSource: "MIX prefers audio and fills gaps with FFT. WAVFLAC is audio only. FFT uses proprietary spectral files only.",
    dpo_spectrogramConcatenation: "How plots or MAT files are grouped. None is one file per source clip. Concatenate accumulates until size limits. Daily/Weekly collate averages. Adjacent stitches clips for searches of 5 minutes or less.",
    dpo_spectralDataDownsample: "MAT resolution. 1 is the pre-generated one-minute average. 2 matches spectrogram plot resolution. 0 is full resolution and is slow to generate.",
    dpo_spectrogramColourPalette: "Spectrogram colour map. 0 is the ONC rainbow default; 1–5 are perceptually balanced palettes.",
    dpo_lowerColourLimit: "Lower colour-scale limit in dB. −1000 uses the device calibration default.",
    dpo_upperColourLimit: "Upper colour-scale limit in dB. −1000 uses the device calibration default.",
    dpo_spectrogramFrequencyUpperLimit: "Upper frequency shown on the spectrogram. −1 uses the calibration / sample-rate limit.",
    dpo_filePlotBreaks: "How often HSPD files or plots break. Weekly (2) is the default and breaks at Sunday midnight UTC. Daily (1) breaks at midnight. None (0) only breaks on a configuration change.",
    dpo_spectralProbabilityDensityColourAxisUpperLimit: "Upper limit of the SPD probability colour axis. 0 uses the default scale.",
    dpo_spectralProbabilityDensityPSDRange: "PSD dB range on the SPD plot. 0 uses the default range; other values set explicit limits such as 40–160 dB."
  };

  const DPO_VALUE_LABELS = {
    dpo_filePlotBreaks: { "0": "None", "1": "Daily", "2": "Weekly", "3": "Hourly", "4": "Monthly", "5": "Yearly" },
    dpo_hydrophoneAcquisitionMode: { All: "all modes", LF: "low frequency", HF: "high frequency" },
    dpo_hydrophoneChannel: { All: "all channels", H1: "channel H1", H2: "channel H2", H3: "channel H3" },
    dpo_hydrophoneDataDiversionMode: { All: "all data", OD: "original data", LPF: "low-pass filtered", HPF: "high-pass filtered" },
    dpo_spectrogramSource: { MIX: "audio preferred, FFT fills gaps", WAVFLAC: "audio only", FFT: "FFT only", WAV: "audio only" },
    dpo_spectrogramConcatenation: {
      None: "one file per source clip",
      Concatenate: "until size limit",
      Daily: "daily",
      Weekly: "weekly",
      Adjacent: "adjacent clips (≤5 min)"
    },
    dpo_spectralDataDownsample: { "0": "full resolution", "1": "one-minute", "2": "spectrogram resolution" },
    dpo_spectrogramColourPalette: {
      "0": "ONC rainbow",
      "1": "blue–purple",
      "2": "grayscale",
      "3": "blue–red",
      "4": "burgundy–beige",
      "5": "fuchsia–chartreuse"
    },
    dpo_audioFormatConversion: { "0": "no conversion", "1": "convert format" },
    dpo_audioDownsample: { "-1": "sampling rate" },
    dpo_lowerColourLimit: { "-1000": "use calibration" },
    dpo_upperColourLimit: { "-1000": "use calibration" },
    dpo_spectrogramFrequencyUpperLimit: { "-1": "use calibration / sample rate", "1000": "1000 Hz", "10000": "10 000 Hz" },
    dpo_spectralProbabilityDensityColourAxisUpperLimit: { "0": "default scale" },
    dpo_spectralProbabilityDensityPSDRange: { "0": "default range", "40_160": "40–160 dB", "40_140": "40–140 dB", "20_140": "20–140 dB" }
  };

  function dpoOptionLabel(option, value, isDefault) {
    const labels = DPO_VALUE_LABELS[option] || {};
    const note = labels[String(value)];
    let text = String(value);
    if (note) text += " — " + note;
    if (isDefault) text += " (default)";
    return text;
  }

  function renderDpoFields(format) {
    const box = $("api-dpo-fields");
    if (!box) return;
    const options = (format && format.options) || [];
    if (!options.length) {
      box.innerHTML = "<p class='api-hint'>This product has no options to set.</p>";
      updateDpoSummary();
      return;
    }
    box.innerHTML = options.map(function (opt) {
      const id = "dpo-" + opt.option;
      const values = opt.allowableValues || [];
      const range = opt.allowableRange;
      const def = opt.defaultValue == null ? "" : String(opt.defaultValue);
      const attrs = " id='" + id + "' data-dpo='" + escapeHtml(opt.option) +
        "' data-dpo-default='" + escapeHtml(def) + "'";
      const help = DPO_HELP[opt.option] || "Oceans 3.0 data product option for this format.";
      let control;
      if (values.length) {
        control = "<select" + attrs + ">" +
          values.map(function (v) {
            const selected = String(v) === def ? " selected" : "";
            return "<option value='" + escapeHtml(v) + "'" + selected + ">" +
              escapeHtml(dpoOptionLabel(opt.option, v, String(v) === def)) + "</option>";
          }).join("") +
          "</select>";
      } else if (range) {
        const min = range.lowerBound != null ? " min='" + escapeHtml(range.lowerBound) + "'" : "";
        const max = range.upperBound != null ? " max='" + escapeHtml(range.upperBound) + "'" : "";
        control = "<input type='number'" + attrs + min + max + " value='" + escapeHtml(def) + "'>";
      } else {
        control = "<input type='text'" + attrs + " value='" + escapeHtml(def) + "'>";
      }
      const defaultNote = (!values.length && def !== "")
        ? " Default value: " + def + "."
        : "";
      return "<label class='api-field api-dpo-field'><span>" + escapeHtml(opt.option) + "</span>" +
        control +
        "<small class='api-dpo-help'>" + escapeHtml(help + defaultNote) + "</small></label>";
    }).join("");
    updateDpoSummary();
  }

  function changedDpoFields() {
    return Array.from(document.querySelectorAll("[data-dpo]")).filter(function (el) {
      return el.value !== el.getAttribute("data-dpo-default");
    });
  }

  function updateDpoSummary() {
    const label = $("api-dpo-summary");
    if (!label) return;
    const n = changedDpoFields().length;
    label.textContent = n ? "Advanced options (" + n + " changed)" : "Advanced options";
  }

  function syncProductFormats(catalog) {
    const product = productByCode(catalog, ($("api-product") || {}).value);
    const extSel = $("api-order-ext");
    if (!extSel) return;
    const formats = formatsForSelection(catalog, product);
    const safeFormats = formats.length ? formats : [{ extension: "flac" }];
    const current = extSel.value;
    extSel.innerHTML = safeFormats.map(function (f) {
      return "<option value='" + escapeHtml(f.extension) + "'>" + escapeHtml(f.extension) + "</option>";
    }).join("");
    const keep = safeFormats.some(function (f) { return f.extension === current; });
    if (keep) extSel.value = current;
    renderDpoFields(formatForProduct(product, extSel.value));
  }

  function syncPanels() {
    const method = (document.querySelector('input[name="api-method"]:checked') || {}).value || "archive";
    const lookup = (document.querySelector('input[name="api-lookup"]:checked') || {}).value || "location";
    document.querySelectorAll("[data-panel]").forEach(function (el) {
      el.hidden = el.getAttribute("data-panel") !== method;
    });
    const loc = $("api-location");
    const dev = $("api-device");
    if (loc) loc.hidden = lookup !== "location";
    if (dev) dev.hidden = lookup !== "device";
  }

  function updateCode(catalog) {
    const state = currentState(catalog);
    const params = filters(state);

    updateDpoSummary();
    $("api-code-python").textContent = pythonCode(state, params);
    $("api-code-matlab").textContent = matlabCode(state, params);
    $("api-code-curl").textContent = curlCode(state, params);
  }

  function setTab(lang) {
    document.querySelectorAll(".api-tab").forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-lang") === lang);
    });
    document.querySelectorAll(".api-code").forEach(function (pre) {
      pre.hidden = pre.id !== "api-code-" + lang;
    });
  }

  function copyActive() {
    const active = document.querySelector(".api-code:not([hidden])");
    if (!active) return;
    const text = active.textContent;
    const done = function () {
      const btn = $("api-copy");
      if (!btn) return;
      const old = btn.textContent;
      btn.textContent = "Copied";
      setTimeout(function () { btn.textContent = old; }, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () {
        fallbackCopy(text); done();
      });
    } else {
      fallbackCopy(text); done();
    }
  }

  function fallbackCopy(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (err) { /* ignore */ }
    document.body.removeChild(ta);
  }

  function initDefaults() {
    const to = new Date();
    const from = new Date(to.getTime() - 5 * 60 * 1000);
    const fromEl = $("api-date-from");
    const toEl = $("api-date-to");
    if (fromEl && !fromEl.value) fromEl.value = toUtcInput(from);
    if (toEl && !toEl.value) toEl.value = toUtcInput(to);
  }

  function syncDates() {
    const fromEl = $("api-date-from");
    const toEl = $("api-date-to");
    const hint = $("api-date-hint");
    let message = "";
    [fromEl, toEl].forEach(function (el) {
      if (!el) return;
      const bad = el.value.trim() !== "" && !toOncIso(el.value);
      el.classList.toggle("api-invalid", bad);
      if (bad) message = "Use YYYY-MM-DD HH:MM on a 24-hour clock, in UTC.";
    });
    if (!message && fromEl && toEl) {
      const from = toOncIso(fromEl.value);
      const to = toOncIso(toEl.value);
      if (from && to && Date.parse(from) >= Date.parse(to)) {
        message = "The end of the range is not after the start.";
        toEl.classList.add("api-invalid");
      }
    }
    if (hint) hint.textContent = message;
  }

  function init() {
    const catalog = loadCatalog();
    const locations = uniqueBy(catalog.locations || [], function (x) { return x.locationCode; })
      .sort(function (a, b) {
        return (a.locationName || a.locationCode).localeCompare(b.locationName || b.locationCode);
      });
    const devices = uniqueBy(catalog.devices || [], function (x) { return x.deviceCode; })
      .sort(function (a, b) { return a.deviceCode.localeCompare(b.deviceCode); });

    fillDatalist("api-location-list", locations.map(function (loc) {
      const name = (loc.locationName || loc.locationCode).trim();
      return {
        value: loc.locationCode,
        label: name === loc.locationCode ? loc.locationCode : name + " — " + loc.locationCode
      };
    }));
    fillDatalist("api-device-list", devices.map(function (dev) {
      return { value: dev.deviceCode, label: dev.deviceCode };
    }));

    initDefaults();
    syncDates();
    syncArchiveExtensions(catalog);
    syncProducts(catalog);
    syncPanels();
    setTab("python");
    updateCode(catalog);

    function onFormChange(evt) {
      const target = evt.target || {};
      syncPanels();
      if (target.id === "api-product" || target.id === "api-order-ext") {
        syncProductFormats(catalog);
      }
      if (target.id === "api-date-from" || target.id === "api-date-to") {
        syncDates();
      }
      if (target.id === "api-location" || target.id === "api-device" ||
          target.id === "api-date-from" || target.id === "api-date-to" ||
          target.name === "api-lookup") {
        syncArchiveExtensions(catalog);
        syncProducts(catalog);
      }
      updateCode(catalog);
    }

    const form = $("api-builder");
    if (form) {
      form.addEventListener("input", onFormChange);
      form.addEventListener("change", onFormChange);
    }

    document.querySelectorAll(".api-tab").forEach(function (btn) {
      btn.addEventListener("click", function () { setTab(btn.getAttribute("data-lang")); });
    });
    const copyBtn = $("api-copy");
    if (copyBtn) copyBtn.addEventListener("click", copyActive);

    const locInput = $("api-location");
    if (locInput) {
      locInput.addEventListener("change", function () {
        const code = locInput.value.trim();
        const match = (catalog.deployments || []).find(function (d) {
          return d.locationCode === code && d.active;
        }) || (catalog.deployments || []).find(function (d) {
          return d.locationCode === code;
        });
        if (match && $("api-device") && !$("api-device").value) {
          $("api-device").value = match.deviceCode;
        }
        syncArchiveExtensions(catalog);
        syncProducts(catalog);
        updateCode(catalog);
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
